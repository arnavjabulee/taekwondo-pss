package uk.ac.bristol.uobtkd.camera;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.*;
import java.net.URI;

public class JudgeActivity extends Activity {
  private WebView judge;
  private TextView status;
  private String origin = "";

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    CompanionLayout.respectSystemBars(layout);
    layout.setBackgroundColor(Color.rgb(16, 16, 16));
    LinearLayout toolbar = new LinearLayout(this);
    Button home = new Button(this);
    home.setText("Home");
    home.setOnClickListener(v -> finish());
    toolbar.addView(home);
    EditText address = new EditText(this);
    address.setHint("Desktop address");
    address.setSingleLine(true);
    address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
    address.setTextColor(Color.WHITE);
    address.setHintTextColor(Color.GRAY);
    address.setText(getSharedPreferences("companion", MODE_PRIVATE).getString("server", ""));
    toolbar.addView(address, new LinearLayout.LayoutParams(0, -2, 1));
    Button connect = new Button(this);
    connect.setText("Connect");
    toolbar.addView(connect);
    layout.addView(toolbar);
    status = new TextView(this);
    status.setTextColor(Color.LTGRAY);
    status.setText("Enter the desktop address shown on the corner judge page. Then enter the match code.");
    layout.addView(status);
    judge = new WebView(this);
    WebView.setWebContentsDebuggingEnabled(
        (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
    judge.setBackgroundColor(Color.rgb(16, 16, 16));
    judge.getSettings().setJavaScriptEnabled(true);
    judge.getSettings().setDomStorageEnabled(true);
    judge.getSettings().setAllowFileAccess(false);
    judge.getSettings().setAllowContentAccess(false);
    judge.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        return !origin.equals(uri.getScheme() + "://" + uri.getAuthority());
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) status.setText("Cannot reach the desktop. Check the address, Wi-Fi and desktop phone connections, then tap Connect to retry.");
      }
    });
    layout.addView(judge, new LinearLayout.LayoutParams(-1, 0, 1));
    connect.setOnClickListener(v -> {
      String server = address.getText().toString().trim().replaceAll("/+$", "");
      try {
        URI uri = URI.create(server);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
            || uri.getHost() == null || uri.getUserInfo() != null || !uri.getPath().isEmpty()
            || uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException();
        origin = server;
        getSharedPreferences("companion", MODE_PRIVATE).edit().putString("server", server).apply();
        status.setText("Pair using this match's code. The desktop operator must approve your judge slot.");
        judge.loadUrl(server + "/");
        ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(), 0);
        judge.requestFocus();
      } catch (Exception error) {
        status.setText("Enter a full desktop address, for example http://192.168.0.12:8976");
      }
    });
    setContentView(layout);
  }

  @Override
  protected void onDestroy() {
    judge.stopLoading();
    judge.destroy();
    super.onDestroy();
  }
}
