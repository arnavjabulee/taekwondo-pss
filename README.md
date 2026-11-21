# UoBTKD Training Suite

Electronic scoring for taekwondo training and competition.

[Download the Windows app](https://github.com/arnavjabulee/taekwondo-pss/releases/latest). Extract the entire ZIP, then open `Start.cmd`.

1. Open `UoBTKD Training Suite/Start.cmd`.
2. Connect the receiver and configure protectors in **Equipment**.
3. Choose **Competition**, **Court Training** or **Free Training**.
4. Enter names, assign equipment and start.

Use **Settings** for timing, scoring thresholds and sound. **Open spectator window** shows scores on a separate display.

For mobile punch judging, choose 1–3 corner referees on the first **Competition** screen and connect. Scan the QR code on each phone, enter a name and pair, then approve the referee on the desktop. Continue to protector testing when ready. Phones need the same Wi-Fi and browser local-network permission. Each new match requires pairing again.

If phones cannot connect, choose **Enable phone connections** in the Mobile judges panel and approve the Windows prompt. This permanently allows the judge service on your local network only.

For video replay, click **Video replay**. For iPhone, select **Enable iPhone / browser camera**, scan the HTTPS QR code in Safari 18.4+, pair, approve on the laptop, and start recording. Keep Safari open and the phone unlocked. This option needs internet and sends video through Cloudflare. Android can also use the installed camera app on local Wi-Fi. Full recordings are saved in the desktop's `judge-bridge/recordings` folder.

[Build instructions](README-English.md) · [Scoring](PSS-LOGIC.md) · [Shortcuts](KEYBOARD-SHORTCUTS.md)
