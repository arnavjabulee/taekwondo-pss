# iPhone replay camera

Requires iOS 16+ and a Mac with Xcode.

1. Open `UoBTKDReplayCamera.xcodeproj` in Xcode. Select your signing team and a unique bundle identifier.
2. Connect your iPhone, select it as the destination, and run the app.
3. On the same local network as the desktop, scan the camera QR code from desktop replay and tap **Pair camera**.
4. Approve the camera on the desktop, then tap **Start recording**. Keep the app open in landscape.

Video is sent directly to the desktop; no microphone or cloud service is used. Leaving the app stops recording. The desktop supports one replay camera at a time.

Run tests with **Product → Test** in Xcode. A signed iPhone build and device recording test are required before distribution; no iOS installer is bundled with the Windows ZIP.
