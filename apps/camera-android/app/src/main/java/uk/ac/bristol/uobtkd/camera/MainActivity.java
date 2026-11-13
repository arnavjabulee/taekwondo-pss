package uk.ac.bristol.uobtkd.camera;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.muxer.FragmentedMp4Muxer;
import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

public class MainActivity extends Activity {
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService requests = Executors.newSingleThreadExecutor();
  private final ArrayBlockingQueue<byte[]> uploads = new ArrayBlockingQueue<>(5);
  private EditText address, code, name;
  private TextView status;
  private Button pair, start, stop;
  private TextureView preview;
  private volatile String token = "", base = "", generation = "";
  private volatile boolean recording = false,
      approved = false,
      encoderDone = true,
      stopping = false,
      polling = false;
  private CameraDevice camera;
  private CameraCaptureSession capture;
  private MediaCodec encoder;
  private Surface encoderSurface, previewSurface;
  private HandlerThread cameraThread;
  private Thread drainThread, uploadThread;
  private FragmentedMp4Muxer muxer;
  private int track = -1;
  private long firstPts = -1;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setPadding(16, 8, 16, 8);
    layout.setBackgroundColor(Color.rgb(16, 16, 16));
    TextView title = new TextView(this);
    title.setText("UoBTKD Replay Camera · 720p / 30 fps · video only");
    title.setTextSize(18);
    title.setTextColor(Color.WHITE);
    layout.addView(title);
    LinearLayout fields = new LinearLayout(this);
    address = field("Desktop address", fields, 2);
    code = field("Camera code", fields, 1);
    code.setInputType(2);
    name = field("Camera name", fields, 1);
    name.setText(Build.MODEL);
    layout.addView(fields);
    LinearLayout buttons = new LinearLayout(this);
    pair = button("Pair camera", buttons, () -> pair());
    start = button("Start recording", buttons, () -> startRecording());
    stop =
        button(
            "Stop recording",
            buttons,
            () -> stopRecording("Recording stopped. Buffered replay remains on the desktop."));
    start.setEnabled(false);
    stop.setEnabled(false);
    layout.addView(buttons);
    status = new TextView(this);
    status.setTextColor(Color.LTGRAY);
    status.setText(
        "Pair using the camera code in the desktop replay window. Keep this app open while"
            + " recording.");
    layout.addView(status);
    preview = new TextureView(this);
    layout.addView(preview, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    readIntent(getIntent());
    main.postDelayed(this::poll, 1000);
  }

  private EditText field(String hint, LinearLayout parent, int weight) {
    EditText field = new EditText(this);
    field.setTextColor(Color.WHITE);
    field.setHintTextColor(Color.GRAY);
    field.setHint(hint);
    field.setSingleLine(true);
    parent.addView(field, new LinearLayout.LayoutParams(0, -2, weight));
    return field;
  }

  private Button button(String text, LinearLayout parent, Runnable action) {
    Button b = new Button(this);
    b.setText(text);
    b.setOnClickListener(v -> action.run());
    parent.addView(b);
    return b;
  }

  private void message(String value) {
    main.post(() -> status.setText(value));
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    readIntent(intent);
  }

  private void readIntent(Intent intent) {
    Uri uri = intent.getData();
    if (uri != null && "uobtkd-camera".equals(uri.getScheme())) {
      String server = uri.getQueryParameter("server"), pin = uri.getQueryParameter("code");
      if (server != null) address.setText(server);
      if (pin != null) code.setText(pin);
    }
  }

  private JSONObject api(String route, byte[] data, String type) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(base + route).openConnection();
    connection.setConnectTimeout(2500);
    connection.setReadTimeout(5000);
    connection.setRequestProperty("Authorization", "Bearer " + token);
    try {
      if (data != null) {
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", type);
        connection.setFixedLengthStreamingMode(data.length);
        try (OutputStream stream = connection.getOutputStream()) {
          stream.write(data);
        }
      }
      int result = connection.getResponseCode();
      InputStream stream = result < 400 ? connection.getInputStream() : connection.getErrorStream();
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      if (stream != null) {
        byte[] block = new byte[4096];
        int count;
        while ((count = stream.read(block)) != -1) output.write(block, 0, count);
      }
      String response =
          output.size() == 0
              ? "{}"
              : new String(output.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
      JSONObject json = new JSONObject(response);
      if (result >= 400)
        throw new IOException(json.optString("error", "Connection failed: " + result));
      return json;
    } finally {
      connection.disconnect();
    }
  }

  private void pair() {
    if (recording) return;
    String server = address.getText().toString().trim().replaceAll("/+$", "");
    try {
      URI uri = URI.create(server);
      if (!"http".equals(uri.getScheme())
          || uri.getHost() == null
          || uri.getUserInfo() != null
          || !uri.getPath().isEmpty()) throw new Exception();
    } catch (Exception e) {
      message("Enter the full desktop address, for example http://192.168.0.12:8976");
      return;
    }
    base = server;
    String pin = code.getText().toString().trim(), label = name.getText().toString();
    pair.setEnabled(false);
    message("Pairing…");
    requests.execute(
        () -> {
          try {
            JSONObject input = new JSONObject().put("code", pin).put("name", label);
            JSONObject reply =
                api(
                    "/api/camera/pair",
                    input.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    "application/json");
            token = reply.getString("token");
            approved = false;
            message("Paired. Approve this camera in the desktop replay window.");
          } catch (Exception e) {
            message(e.getMessage());
          } finally {
            main.post(() -> pair.setEnabled(true));
          }
        });
  }

  private void poll() {
    if (isFinishing()) return;
    if (!token.isEmpty() && !polling) {
      polling = true;
      requests.execute(
          () -> {
            try {
              JSONObject reply = api("/api/camera/state", null, null);
              boolean previous = approved;
              approved = reply.getBoolean("approved");
              if (approved && !previous && !recording && !stopping)
                message("Camera approved. Tap Start recording.");
              main.post(() -> start.setEnabled(approved && !recording && !stopping));
            } catch (Exception e) {
              if (recording)
                stopRecording(
                    "Connection lost. Recording stopped; no disconnected video is queued. "
                        + e.getMessage());
              else if (!stopping)
                message("Camera connection unavailable. Pair again if the desktop was restarted.");
              approved = false;
              main.post(() -> start.setEnabled(false));
            } finally {
              polling = false;
            }
          });
    }
    main.postDelayed(this::poll, 1000);
  }

  private void startRecording() {
    if (!approved || recording || stopping) return;
    if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {Manifest.permission.CAMERA}, 1);
      return;
    }
    if (!preview.isAvailable()) {
      message("Wait for the camera preview surface.");
      return;
    }
    start.setEnabled(false);
    message("Starting recording…");
    requests.execute(
        () -> {
          try {
            generation =
                api("/api/camera/start", new byte[0], "application/json").getString("generation");
            recording = true;
            encoderDone = false;
            uploads.clear();
            firstPts = -1;
            track = -1;
            cameraThread = new HandlerThread("UoBTKD-camera");
            cameraThread.start();
            Handler handler = new Handler(cameraThread.getLooper());
            encoder = MediaCodec.createEncoderByType("video/avc");
            MediaFormat format = MediaFormat.createVideoFormat("video/avc", 1280, 720);
            format.setInteger(
                MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            format.setInteger(MediaFormat.KEY_BIT_RATE, 4000000);
            format.setInteger(MediaFormat.KEY_FRAME_RATE, 30);
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            format.setInteger(
                MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline);
            format.setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0);
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoderSurface = encoder.createInputSurface();
            encoder.start();
            muxer =
                new FragmentedMp4Muxer.Builder(new FragmentOutput())
                    .setFragmentDurationMs(500)
                    .build();
            CameraManager manager = (CameraManager) getSystemService(CAMERA_SERVICE);
            String selected = null;
            for (String id : manager.getCameraIdList())
              if (manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING)
                  == CameraCharacteristics.LENS_FACING_BACK) {
                selected = id;
                break;
              }
            if (selected == null) throw new IOException("No rear camera available");
            drainThread = new Thread(this::drain, "UoBTKD-encode");
            uploadThread = new Thread(this::upload, "UoBTKD-upload");
            drainThread.start();
            uploadThread.start();
            manager.openCamera(
                selected,
                new CameraDevice.StateCallback() {
                  public void onOpened(CameraDevice value) {
                    if (!recording) {
                      value.close();
                      return;
                    }
                    camera = value;
                    try {
                      SurfaceTexture texture = preview.getSurfaceTexture();
                      texture.setDefaultBufferSize(1280, 720);
                      previewSurface = new Surface(texture);
                      List<Surface> targets = Arrays.asList(encoderSurface, previewSurface);
                      camera.createCaptureSession(
                          targets,
                          new CameraCaptureSession.StateCallback() {
                            public void onConfigured(CameraCaptureSession session) {
                              if (!recording) {
                                session.close();
                                return;
                              }
                              capture = session;
                              try {
                                CaptureRequest.Builder request =
                                    camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
                                for (Surface s : targets) request.addTarget(s);
                                request.set(
                                    CaptureRequest.CONTROL_AF_MODE,
                                    CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
                                request.set(
                                    CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                                    new android.util.Range<>(30, 30));
                                capture.setRepeatingRequest(request.build(), null, handler);
                                message(
                                    "RECORDING · Keep this app open. Video is buffered on the"
                                        + " desktop.");
                              } catch (Exception e) {
                                fail(e);
                              }
                            }

                            public void onConfigureFailed(CameraCaptureSession session) {
                              fail(new IOException("Camera setup failed"));
                            }
                          },
                          handler);
                    } catch (Exception e) {
                      fail(e);
                    }
                  }

                  public void onDisconnected(CameraDevice value) {
                    value.close();
                    fail(new IOException("Camera disconnected"));
                  }

                  public void onError(CameraDevice value, int error) {
                    value.close();
                    fail(new IOException("Camera error " + error));
                  }
                },
                handler);
            main.post(
                () -> {
                  stop.setEnabled(true);
                  pair.setEnabled(false);
                  address.setEnabled(false);
                  code.setEnabled(false);
                });
          } catch (Exception e) {
            fail(e);
          }
        });
  }

  @Override
  public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(request, permissions, results);
    if (request == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
      startRecording();
    else message("Camera permission is required.");
  }

  private void drain() {
    try {
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      long stoppedAt = 0;
      while (true) {
        if (!recording) {
          if (stoppedAt == 0) stoppedAt = SystemClock.elapsedRealtime();
          if (SystemClock.elapsedRealtime() - stoppedAt > 1500) break;
        }
        int index = encoder.dequeueOutputBuffer(info, 10000);
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          MediaFormat f = encoder.getOutputFormat();
          List<byte[]> csd = new ArrayList<>();
          for (String key : Arrays.asList("csd-0", "csd-1")) {
            ByteBuffer b = f.getByteBuffer(key);
            if (b != null) {
              byte[] bytes = new byte[b.remaining()];
              b.get(bytes);
              csd.add(bytes);
            }
          }
          track =
              muxer.addTrack(
                  new Format.Builder()
                      .setSampleMimeType(MimeTypes.VIDEO_H264)
                      .setWidth(1280)
                      .setHeight(720)
                      .setFrameRate(30)
                      .setInitializationData(csd)
                      .build());
        } else if (index >= 0) {
          ByteBuffer b = encoder.getOutputBuffer(index);
          if (info.size > 0
              && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
              && track >= 0) {
            if (firstPts < 0) firstPts = info.presentationTimeUs;
            b.position(info.offset);
            b.limit(info.offset + info.size);
            muxer.writeSampleData(
                track,
                b,
                new androidx.media3.muxer.BufferInfo(
                    info.presentationTimeUs - firstPts,
                    info.size,
                    info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME));
          }
          encoder.releaseOutputBuffer(index, false);
          if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
        }
      }
    } catch (Exception e) {
      if (recording) fail(e);
    }
  }

  private void upload() {
    int index = 0;
    try {
      while (recording || !encoderDone || !uploads.isEmpty()) {
        byte[] data = uploads.poll(1, TimeUnit.SECONDS);
        if (data == null) continue;
        api("/api/camera/chunk?generation=" + generation + "&index=" + index, data, "video/mp4");
        index++;
      }
    } catch (Exception e) {
      if (recording) fail(e);
    } finally {
      try {
        api("/api/camera/stop?generation=" + generation, new byte[0], "application/json");
      } catch (Exception ignored) {
      }
    }
  }

  private void fail(Exception e) {
    stopRecording("Recording stopped: " + e.getMessage());
  }

  private synchronized void stopRecording(String reason) {
    boolean wasRecording = recording;
    recording = false;
    if (!wasRecording) {
      message(reason);
      return;
    }
    stopping = true;
    main.post(
        () -> {
          stop.setEnabled(false);
          status.setText("Finishing recording…");
        });
    new Thread(
            () -> {
              try {
                if (capture != null) capture.close();
                if (camera != null) camera.close();
                if (encoder != null) {
                  try {
                    encoder.signalEndOfInputStream();
                  } catch (Exception ignored) {
                  }
                }
                if (drainThread != null && drainThread != Thread.currentThread())
                  drainThread.join(2000);
                if (muxer != null) muxer.close();
              } catch (Exception ignored) {
              } finally {
                if (encoder != null) {
                  try {
                    encoder.stop();
                  } catch (Exception ignored) {
                  }
                  try {
                    encoder.release();
                  } catch (Exception ignored) {
                  }
                }
                if (encoderSurface != null) encoderSurface.release();
                if (previewSurface != null) previewSurface.release();
                if (cameraThread != null) cameraThread.quitSafely();
                encoderDone = true;
                try {
                  if (uploadThread != null) uploadThread.join(45000);
                } catch (InterruptedException ignored) {
                }
                muxer = null;
                encoder = null;
                camera = null;
                capture = null;
                stopping = false;
                main.post(
                    () -> {
                      stop.setEnabled(false);
                      start.setEnabled(approved);
                      pair.setEnabled(true);
                      address.setEnabled(true);
                      code.setEnabled(true);
                      status.setText(reason);
                    });
              }
            },
            "UoBTKD-stop")
        .start();
  }

  @Override
  protected void onPause() {
    super.onPause();
    if (recording)
      stopRecording("Recording stopped because the camera app went into the background.");
  }

  @Override
  protected void onDestroy() {
    super.onDestroy();
    main.removeCallbacksAndMessages(null);
    requests.shutdownNow();
  }

  private class FragmentOutput extends OutputStream {
    private ByteArrayOutputStream pending = new ByteArrayOutputStream(),
        group = new ByteArrayOutputStream();

    @Override
    public void write(int b) throws IOException {
      write(new byte[] {(byte) b}, 0, 1);
    }

    @Override
    public synchronized void write(byte[] bytes, int offset, int length) throws IOException {
      pending.write(bytes, offset, length);
      byte[] data = pending.toByteArray();
      int at = 0;
      while (data.length - at >= 8) {
        int size = ByteBuffer.wrap(data, at, 4).getInt();
        if (size < 8 || size > 8 * 1024 * 1024) throw new IOException("Invalid video box size");
        if (at + size > data.length) break;
        String type = new String(data, at + 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
        group.write(data, at, size);
        at += size;
        if (type.equals("moov") || type.equals("mdat")) {
          if (!uploads.offer(group.toByteArray()))
            throw new IOException("Network too slow; restart recording closer to the router");
          group.reset();
        }
      }
      if (at > 0) {
        pending.reset();
        pending.write(data, at, data.length - at);
      }
      if (pending.size() > 8 * 1024 * 1024) throw new IOException("Video fragment too large");
    }
  }
}
