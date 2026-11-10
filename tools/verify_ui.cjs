/* Browser regression check with synthetic athletes; never contacts a receiver. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = path.resolve(__dirname, '../LedaSport-English/nginx/html/train');
const artifacts = path.resolve(__dirname, '../test-results');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

async function verifyFreeTraining(page, artifacts) {
  await page.getByRole('button', { name: 'Free Training', exact: true }).click();
  await page.locator('.pss-free').waitFor();
  assert.equal(
    await page.getByRole('combobox', { name: 'Existing athlete', exact: true }).count(),
    0
  );
  assert.equal(
    await page.getByRole('button', { name: 'Add selected athlete', exact: true }).count(),
    0
  );
  await page
    .locator('.pss-audio-controls')
    .getByRole('button', { name: 'Test sound', exact: true })
    .click();
  assert.equal(await page.evaluate(() => window.PSS_AUDIO.status().state), 'running');
  await page.evaluate(() => {
    window.__audioCues = [];
    window.PSS_AUDIO.subscribe((cue) => window.__audioCues.push(cue));
  });
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  let people = page.locator('.pss-free-person');
  await people.nth(0).locator('[data-person-name]').fill('Riley');
  await people
    .nth(0)
    .getByLabel(/^Body protector for /)
    .selectOption('000000000001');
  await people
    .nth(0)
    .getByLabel(/^Body protector for /)
    .press('Tab');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await people.nth(1).locator('[data-person-name]').fill('Sam');
  await people
    .nth(1)
    .getByLabel(/^Body protector for /)
    .selectOption('000000000002');
  await people
    .nth(1)
    .getByLabel(/^Body protector for /)
    .press('Tab');
  await page.evaluate(() => {
    const view = document.querySelector('.pss-free').__vue__,
      host = view.$parent;
    if (host.mqtt_client) {
      host.mqtt_client.removeAllListeners('close');
      host.mqtt_client.end(true);
    }
    host.mqtt_client = { subscribe() {}, publish() {}, end() {} };
    window.__freeOriginalSend = host.sendMessage;
    window.__freeCommands = [];
    host.sendMessage = (topic, payload) => window.__freeCommands.push({ topic, payload });
    host.onClientState(true);
  });
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click();
  await people.nth(0).locator('[data-person-name]').fill('Riley Morgan');
  await page.evaluate(() => window.OnVkSpace());
  assert.equal(
    await page.getByRole('button', { name: 'Pause tracking', exact: true }).isVisible(),
    true
  );
  await page.evaluate(() => {
    const host = document.querySelector('.pss-free').__vue__.$parent;
    host.onAuthClientMessage('DevData', '000000000001,value:320');
    host.onAuthClientMessage('DevData', '000000000002,value:2865');
  });
  assert.equal(await people.nth(0).locator('.pss-free-score').innerText(), 'Score: 1');
  assert.equal(await people.nth(1).locator('.pss-free-score').innerText(), 'Score: 1');
  assert.deepEqual(
    await page.evaluate(() =>
      window.__audioCues.filter((c) => c.type === 'hit').map((c) => [c.kind, c.key, c.played])
    ),
    [
      ['person', 1, true],
      ['person', 2, true]
    ]
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('.pss-free').__vue__.$parent.timer),
    null
  );
  await people
    .nth(0)
    .getByLabel(/^Body protector for /)
    .selectOption('000000000002');
  assert.equal(
    await people
      .nth(1)
      .getByLabel(/^Body protector for /)
      .inputValue(),
    '000000000001'
  );
  await page.evaluate(() =>
    document
      .querySelector('.pss-free')
      .__vue__.$parent.onAuthClientMessage('DevData', '000000000001,value:320')
  );
  assert.equal(await people.nth(0).locator('.pss-free-score').innerText(), 'Score: 1');
  assert.equal(await people.nth(1).locator('.pss-free-score').innerText(), 'Score: 2');
  assert.equal(await people.nth(0).locator('[data-person-name]').inputValue(), 'Riley Morgan');
  await people
    .nth(0)
    .getByLabel(/^Body protector for /)
    .selectOption('000000000001');
  await people.nth(1).getByRole('button', { name: 'Reset score', exact: true }).click();
  await page.evaluate(() =>
    document
      .querySelector('.pss-free')
      .__vue__.$parent.onAuthClientMessage('DevData', '000000000002,value:320')
  );
  await people.nth(0).getByRole('button', { name: 'Reset score', exact: true }).click();
  assert.equal(await people.nth(0).locator('.pss-free-score').innerText(), 'Score: 0');
  assert.equal(await people.nth(1).locator('.pss-free-score').innerText(), 'Score: 1');
  await page.getByRole('button', { name: 'Reset group scores', exact: true }).click();
  assert.equal(await people.nth(1).locator('.pss-free-score').innerText(), 'Score: 0');
  await page.evaluate(() =>
    document
      .querySelector('.pss-free')
      .__vue__.$parent.onAuthClientMessage('DevData', '000000000001,value:320')
  );
  await page.getByRole('button', { name: 'Pause tracking', exact: true }).click();
  await page.evaluate(() =>
    document
      .querySelector('.pss-free')
      .__vue__.$parent.onAuthClientMessage('DevData', '000000000001,value:320')
  );
  assert.equal(await people.nth(0).locator('.pss-free-score').innerText(), 'Score: 1');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await people.nth(2).getByRole('button', { name: 'Remove person', exact: true }).click();
  assert.equal(await people.count(), 2);
  const freePopup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open spectator window', exact: true }).click();
  const freeTV = await freePopup;
  await freeTV.locator('.scoreboard.training').waitFor();
  await freeTV.locator('.training-person h2').getByText('Riley Morgan', { exact: true }).waitFor();
  assert.equal(await freeTV.locator('.training-person').count(), 2);
  await people.nth(0).locator('[data-person-name]').fill('Riley Live');
  await freeTV.locator('.training-person h2').getByText('Riley Live', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reset group scores', exact: true }).click();
  await freeTV
    .locator('#training-status')
    .getByText(/Group score: 0/)
    .waitFor();
  assert.equal(await freeTV.locator('.match-centre').isVisible(), false);
  await freeTV.screenshot({ path: path.join(artifacts, 'spectator-free.png') });
  await people.nth(0).locator('[data-person-name]').fill('Riley Morgan');
  // Restore the persisted score expected below, without sending any hardware command.
  await page.evaluate(() => {
    const v = document.querySelector('.pss-free').__vue__;
    v.session.participants[0].score = 1;
    v.save();
  });
  await page.getByRole('button', { name: 'Close spectator window', exact: true }).click();
  await freeTV.waitForEvent('close');
  await page.screenshot({ path: require('node:path').join(artifacts, 'free-training.png') });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Free Training', exact: true }).click();
  people = page.locator('.pss-free-person');
  assert.equal(await people.nth(0).locator('[data-person-name]').inputValue(), 'Riley Morgan');
  assert.equal(await people.nth(0).locator('.pss-free-score').innerText(), 'Score: 1');
  assert.equal(
    await page.getByRole('button', { name: 'Start tracking', exact: true }).isVisible(),
    true
  );
  await people.nth(1).getByRole('button', { name: 'Remove person', exact: true }).click();
  assert.equal(await people.count(), 1);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.evaluate(() => {
    const host = (document.getElementById('id_home') || document.querySelector('.pss-inventory'))
      .__vue__.$parent;
    host.sendMessage = window.__freeOriginalSend;
    host.onClientState(false);
  });
}

async function verifyEquipment(page, artifacts) {
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  const inventory = page.locator('.pss-inventory');
  await inventory.waitFor();
  await inventory.getByRole('columnheader', { name: 'ID', exact: true }).waitFor();
  assert.equal(
    await inventory.getByRole('columnheader', { name: 'Information', exact: true }).count(),
    0
  );
  assert.equal(
    await page.getByRole('button', { name: 'Equipment details', exact: true }).count(),
    0
  );
  assert.equal((await inventory.innerText()).includes('Alex Morgan'), false);
  assert.equal(
    await inventory
      .locator('[data-equipment="000000000001"]')
      .getByLabel('Colour', { exact: true })
      .inputValue(),
    'Blue'
  );
  for (const id of ['000000000001', '000000000002']) {
    const row = inventory.locator('[data-equipment="' + id + '"]');
    await row.getByLabel('Colour', { exact: true }).selectOption('Red');
    await row.getByLabel('Colour', { exact: true }).press('Tab');
    assert.equal(
      await page.evaluate((id) => window.PSS_EQUIPMENT.registry.find(id).colour, id),
      'Red'
    );
    await row.getByLabel('Size', { exact: true }).fill('2');
    await row.getByLabel('Size', { exact: true }).press('Tab');
  }
  assert.equal(await inventory.locator('[data-equipment="000000000001"] th').innerText(), 'Red 2');
  assert.equal(
    await inventory.locator('[data-equipment="000000000002"] th').innerText(),
    'Red 2 (2)'
  );
  const row = inventory.locator('[data-equipment="000000000002"]');
  await row.getByLabel('Size', { exact: true }).fill('2 ');
  await page.evaluate(() => {
    const host = document.querySelector('.pss-inventory').__vue__.$parent;
    host.UpdateDeviceState('000000000002:huju,000000000001:huju');
    window.PSS_EQUIPMENT.setOnline(true);
    host.onAuthClientMessage(
      host.clientid,
      JSON.stringify({ res: 'DevBattery', from: '000000000001', batt_id: 2 })
    );
    host.onAuthClientMessage(
      host.clientid,
      JSON.stringify({ res: 'DevBattery', from: '000000000002', batt_id: 1, percentage: 73 })
    );
  });
  assert.equal(await row.getByLabel('Size', { exact: true }).inputValue(), '2 ');
  await row.getByLabel('Size', { exact: true }).press('Tab');
  await inventory
    .locator('[data-equipment="000000000001"]')
    .getByText('Medium battery', { exact: true })
    .waitFor();
  await row.getByText('73%', { exact: true }).waitFor();
  await row.getByLabel('Device ID', { exact: true }).waitFor();
  assert.equal(await row.getByLabel('Device ID', { exact: true }).inputValue(), '000000000002');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.evaluate(() => {
    const host = document.querySelector('.pss-inventory').__vue__.$parent;
    host.UpdateDeviceState(
      '000000000001:huju,000000000002:huju,000000000005:xlhuju,000000000006:huju,000000000015:xltoukui,000000000099:huju'
    );
  });
  const blue = inventory.locator('[data-equipment="000000000003"]');
  const available = await blue
    .getByLabel('Device ID', { exact: true })
    .locator('option')
    .evaluateAll((options) => options.map((item) => item.value));
  assert(available.includes('000000000005'));
  assert(!available.includes('000000000006'));
  assert(!available.includes('000000000015'));
  assert(!available.includes('000000000001'));
  await blue.getByLabel('Device ID', { exact: true }).selectOption('000000000005');
  const replaced = inventory.locator('[data-equipment="000000000005"]');
  await replaced.waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('1_changdi_data')).left.huju),
    '000000000005'
  );
  await replaced.getByLabel('Device ID', { exact: true }).selectOption('000000000003');
  await inventory.getByLabel('New equipment colour', { exact: true }).selectOption('Blue');
  await inventory.getByLabel('New device ID', { exact: true }).selectOption('000000000099');
  await inventory.getByLabel('New equipment size', { exact: true }).fill('3');
  await inventory.getByRole('button', { name: 'Add equipment', exact: true }).click();
  const added = inventory.locator('[data-equipment="000000000099"]');
  await added.getByText('Blue 3', { exact: true }).waitFor();
  await page.evaluate(() =>
    localStorage.setItem(
      'bristol_free_training_v1',
      JSON.stringify({ participants: [{ bodyId: '000000000099', helmetId: '' }] })
    )
  );
  await added.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('bristol_free_training_v1')).participants[0].bodyId
    ),
    ''
  );
  await page.evaluate(() => localStorage.removeItem('bristol_free_training_v1'));
  assert.equal(await inventory.locator('[data-equipment="000000000099"]').count(), 0);
  await page.evaluate(() => {
    const host = document.querySelector('.pss-inventory').__vue__.$parent;
    host.UpdateDeviceState('000000000099:huju');
    window.PSS_EQUIPMENT.label('000000000099', 'body');
  });
  assert.equal(await inventory.locator('[data-equipment="000000000099"]').count(), 0);
  await inventory.getByLabel('New equipment colour', { exact: true }).selectOption('Blue');
  await inventory.getByLabel('New device ID', { exact: true }).selectOption('000000000099');
  await inventory.getByLabel('New equipment size', { exact: true }).fill('3');
  await inventory.getByRole('button', { name: 'Add equipment', exact: true }).click();
  await inventory.locator('[data-equipment="000000000099"]').waitFor();
  await page.screenshot({ path: path.join(artifacts, 'equipment.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Main menu' }).waitFor();
}

async function verifyCompetition(page, artifacts) {
  const autoPopup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Competition', exact: true }).click();
  let tv = await autoPopup;
  const tvSockets = [];
  tv.on('websocket', (socket) => tvSockets.push(socket.url()));
  await tv.locator('.scoreboard.testing').waitFor();
  await page.getByLabel('Blue competitor name', { exact: true }).fill('Alex Live');
  await page.getByLabel('Red competitor name', { exact: true }).fill('Sam Taylor');
  await page.getByLabel('Blue Body protector', { exact: true }).selectOption('000000000001');
  await page.getByLabel('Red Body protector', { exact: true }).selectOption('000000000002');
  await page.getByLabel('Blue Head protector', { exact: true }).selectOption('000000000011');
  await page.getByLabel('Red Head protector', { exact: true }).selectOption('000000000012');
  assert(
    (await page.getByLabel('Red Body protector', { exact: true }).innerText()).includes('Red 2 (2)')
  );
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  await page.locator('.pss-inventory').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.pss-competition-setup').waitFor();
  await page.evaluate(() => {
    const host = document.querySelector('.pss-competition-setup').__vue__.$parent;
    host.mqtt_client = { subscribe() {}, publish() {}, end() {} };
    host.onClientState(true);
    host.onAuthClientMessage('DevData', '000000000001,value:40');
    host.onAuthClientMessage('DevData', '000000000002,value:320');
    host.onAuthClientMessage('DevData', '000000000011,value:120');
  });
  assert.match(
    await page.locator('[data-test-side="blue"][data-test-kind="bodyId"]').innerText(),
    /Received 1 signals.*raw 40/
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector('.pss-competition-setup').__vue__.$parent.timer
    ),
    null
  );
  await page.screenshot({ path: path.join(artifacts, 'competition-test.png') });
  await tv.locator('#test-blue-body .test-reading').getByText('1.00', { exact: true }).waitFor();
  await tv.locator('#test-blue-head .test-reading').getByText('3.00', { exact: true }).waitFor();
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.screenshot({ path: path.join(artifacts, 'spectator-test.png') });
  await page.getByRole('button', { name: 'Enter match mode', exact: true }).click();
  await page.locator('.pss-competition .leda-courts:visible').waitFor();
  assert.equal(await page.locator('.leda-courts:visible .pss-court').count(), 1);
  assert.equal(await page.locator('.dropdown-toggle:visible').count(), 0);
  assert.equal(await page.locator('.leda-courts:visible input[type="text"]').count(), 0);
  assert.equal(await page.locator('.leda-courts:visible .pss-score').nth(1).innerText(), '0');
  await page.evaluate(() => {
    const host = document.querySelector('.leda-training').__vue__.$parent;
    host.mqtt_client = { subscribe() {}, publish() {}, end() {} };
    host.onClientState(true);
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.evaluate(() => {
    const controller = document.querySelector('.leda-training').__vue__;
    clearInterval(controller.$parent.timer);
    controller.$parent.timer = null;
    controller.$parent.onAuthClientMessage('DevData', '000000000001,value:320');
  });
  assert.equal(await page.locator('.leda-courts:visible .pss-score').nth(1).innerText(), '2');
  await page
    .locator('.leda-courts:visible')
    .getByRole('button', { name: 'Open spectator window', exact: true })
    .click();
  await tv.locator('#red-score').getByText('2', { exact: true }).waitFor();
  assert.equal(
    await tv.locator('#red-leading').evaluate((el) => el.classList.contains('lit')),
    true
  );
  assert.equal(
    await tv.locator('#blue-leading').evaluate((el) => el.classList.contains('lit')),
    false
  );
  assert.equal(await tv.locator('#blue-name').innerText(), 'Alex Live');
  assert.equal(await tv.locator('#red-name').innerText(), 'Sam Taylor');
  assert.equal(await tv.locator('input,select').count(), 0);
  await tv.setViewportSize({ width: 1920, height: 1080 });
  for (const size of [
    { width: 1280, height: 1024 },
    { width: 2560, height: 1080 },
    { width: 1920, height: 1080 }
  ]) {
    await tv.setViewportSize(size);
    await tv.waitForFunction(() => {
      const b = document.querySelector('.scoreboard').getBoundingClientRect();
      return (
        b.width <= innerWidth + 1 &&
        b.height <= innerHeight + 1 &&
        Math.abs(b.width - Math.min(innerWidth / 1920, innerHeight / 1080) * 1920) < 1 &&
        Math.abs(b.left - (innerWidth - b.width) / 2) < 1 &&
        Math.abs(b.width / b.height - 16 / 9) < 0.01
      );
    });
    const clockBox = await tv.locator('#clock').boundingBox();
    const centreBox = await tv.locator('.match-centre').boundingBox();
    assert(
      clockBox.x >= centreBox.x - 1 &&
        clockBox.x + clockBox.width <= centreBox.x + centreBox.width + 1
    );
  }
  await page.getByRole('tab', { name: 'Spectator display', exact: true }).click();
  const preview = page.frameLocator('iframe:visible');
  await preview.locator('#red-score').getByText('2', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    2
  );
  await page.getByRole('tab', { name: 'Control panel', exact: true }).click();
  const liveCourt = page.locator('.leda-courts:visible');
  await liveCourt.getByRole('button', { name: 'Blue technical body +2', exact: true }).click();
  await tv.waitForFunction(
    () =>
      document.getElementById('blue-leading').classList.contains('lit') &&
      !document.getElementById('red-leading').classList.contains('lit')
  );
  await liveCourt.getByRole('button', { name: 'Blue technical head +3', exact: true }).click();
  assert.match(
    await liveCourt.locator('.pss-blue .pss-kick-stats').innerText(),
    /Technical kicks: body 1.*head 1/
  );
  assert.equal(await liveCourt.locator('.pss-score').first().innerText(), '5');
  await liveCourt.getByRole('button', { name: 'Blue undo technical head', exact: true }).click();
  await liveCourt.getByRole('button', { name: 'Blue undo technical body', exact: true }).click();
  assert.equal(await liveCourt.locator('.pss-score').first().innerText(), '0');
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.gameinfo.toukui_gate = 1;
    c.$parent.onAuthClientMessage('DevData', '000000000002,value:200');
  });
  await tv.locator('#blue-weak-body').getByText('1', { exact: true }).waitFor();
  await tv.locator('#blue-weak-meter').waitFor({ state: 'visible' });
  assert.match(await tv.locator('#blue-weak-meter').innerText(), /8\s+5/);
  await tv.screenshot({ path: path.join(artifacts, 'spectator-weak-hit.png') });
  await tv.waitForTimeout(1800);
  await page.evaluate(() =>
    document
      .querySelector('.leda-training')
      .__vue__.$parent.onAuthClientMessage('DevData', '000000000012,value:20')
  );
  await tv.locator('#blue-weak-head').getByText('1', { exact: true }).waitFor();
  assert.match(await tv.locator('#blue-weak-meter').innerText(), /1\s+1/);
  assert.match(
    await liveCourt.locator('.pss-blue .pss-weak-counts').innerText(),
    /head 1.*body 1.*total 2/
  );
  await tv.waitForTimeout(1500);
  assert.equal(await tv.locator('#blue-weak-meter').isVisible(), true);
  await tv.locator('#blue-weak-meter').waitFor({ state: 'hidden', timeout: 2000 });
  await liveCourt.locator('.pss-panel-weak-meter').waitFor({ state: 'hidden', timeout: 2000 });
  assert.equal(await tv.locator('#blue-weak-head').innerText(), '1');
  assert.equal(await tv.locator('#blue-weak-body').innerText(), '1');
  const beforeDisconnect = await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    return { time: c.time, score: c.gvi.game[0].right.score };
  });
  await page.evaluate(() => {
    const host = document.querySelector('.leda-training').__vue__.$parent;
    host.mqtt_client = {
      connected: false,
      publish() {
        throw Error('Disconnected');
      },
      subscribe() {
        throw Error('Disconnected');
      },
      end() {}
    };
    host.onClientState(false);
  });
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    3
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const c = document.querySelector('.leda-training').__vue__;
      return { time: c.time, score: c.gvi.game[0].right.score };
    }),
    beforeDisconnect
  );
  await page.evaluate(() => {
    const host = document.querySelector('.leda-training').__vue__.$parent;
    host.mqtt_client = { connected: true, publish() {}, subscribe() {}, end() {} };
    host.onClientState(true);
  });
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    3
  );
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.evaluate(() => document.querySelector('.leda-training').__vue__.$parent.stopTimer());
  const weakBox = await tv.locator('.blue .weak-summary').boundingBox();
  const gamBox = await tv.locator('#blue-gam-jeoms').boundingBox();
  assert(weakBox.y + weakBox.height < gamBox.y);
  const timeBeforeSwap = await page.evaluate(
    () => document.querySelector('.leda-training').__vue__.time
  );

  await page
    .locator('.leda-courts:visible')
    .getByLabel('Court 1 blue body protector', { exact: true })
    .selectOption('000000000099');
  assert.equal(await page.locator('.leda-courts:visible .pss-score').nth(1).innerText(), '2');
  await page
    .locator('.leda-courts:visible')
    .getByLabel('Court 1 blue body protector', { exact: true })
    .selectOption('000000000001');
  await page
    .locator('.leda-courts:visible')
    .getByLabel('Court 1 blue body protector', { exact: true })
    .selectOption('000000000002');
  assert.equal(
    await page
      .locator('.leda-courts:visible')
      .getByLabel('Court 1 red body protector', { exact: true })
      .inputValue(),
    '000000000001'
  );
  await page.evaluate(() => {
    const host = document.querySelector('.leda-training').__vue__.$parent;
    host.onAuthClientMessage('DevData', '000000000002,value:320');
    host.onAuthClientMessage('DevData', '000000000001,value:320');
  });
  assert.equal(await page.locator('.leda-courts:visible .pss-score').nth(0).innerText(), '2');
  assert.equal(await page.locator('.leda-courts:visible .pss-score').nth(1).innerText(), '4');
  await tv.locator('#red-score').getByText('4', { exact: true }).waitFor();
  await tv.screenshot({ path: path.join(artifacts, 'spectator-running.png') });
  assert.equal(
    await page.locator('.leda-courts:visible .pss-competition-name').first().innerText(),

    'Alex Live'
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.time),
    timeBeforeSwap
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    2
  );
  await page
    .locator('.leda-courts:visible')
    .getByLabel('Court 1 blue body protector', { exact: true })
    .selectOption('000000000001');
  await page.evaluate(() => document.querySelector('.leda-training').__vue__.change_view_mode(3));
  assert.equal(await page.locator('.leda-courts:visible .pss-court').count(), 1);
  await page.locator('.leda-courts:visible .pss-blue .pss-equipment-link').first().click();
  await page.evaluate(() => window.OnVkSpace());
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    2
  );
  await page.getByRole('button', { name: 'Close equipment', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await tv.locator('#phase').getByText('Time out', { exact: true }).waitFor();
  // The native HWND guard now dispatches spectator Escape to its own window.
  await tv.bringToFront();
  const closedByNative = tv.waitForEvent('close');
  await tv.evaluate(() => window.OnVkEscape());
  await closedByNative;
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    3
  );
  let reopen = page.waitForEvent('popup');
  await page
    .locator('.leda-courts:visible')
    .getByRole('button', { name: 'Open spectator window', exact: true })
    .click();
  tv = await reopen;
  tv.on('websocket', (socket) => tvSockets.push(socket.url()));
  await tv.locator('#red-score').getByText('4', { exact: true }).waitFor();
  const closedByKey = tv.waitForEvent('close');
  await tv.keyboard.press('Escape').catch((error) => {
    if (!tv.isClosed()) throw error;
  });
  await closedByKey;
  assert.equal(await page.locator('.pss-competition').count(), 1);
  reopen = page.waitForEvent('popup');
  await page
    .locator('.leda-courts:visible')
    .getByRole('button', { name: 'Open spectator window', exact: true })
    .click();
  tv = await reopen;
  tv.on('websocket', (socket) => tvSockets.push(socket.url()));
  await tv.locator('#red-score').getByText('4', { exact: true }).waitFor();
  await page.bringToFront();
  const closedByButton = tv.waitForEvent('close');
  await tv
    .getByRole('button', { name: 'Close display', exact: true })
    .click()
    .catch((error) => {
      if (!tv.isClosed()) throw error;
    });
  await closedByButton;
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    3
  );
  reopen = page.waitForEvent('popup');
  await page
    .locator('.leda-courts:visible')
    .getByRole('button', { name: 'Open spectator window', exact: true })
    .click();
  tv = await reopen;
  tv.on('websocket', (socket) => tvSockets.push(socket.url()));
  await tv.locator('#red-score').getByText('4', { exact: true }).waitFor();
  const closedByPanel = tv.waitForEvent('close');
  await page
    .locator('.leda-courts:visible')
    .getByRole('button', { name: 'Close spectator window', exact: true })
    .click();
  await closedByPanel;
  reopen = page.waitForEvent('popup');
  await page
    .locator('.leda-courts:visible')
    .getByRole('button', { name: 'Open spectator window', exact: true })
    .click();
  tv = await reopen;
  tv.on('websocket', (socket) => tvSockets.push(socket.url()));
  await tv.locator('#red-score').getByText('4', { exact: true }).waitFor();
  await page.bringToFront();
  const match = page.locator('.leda-courts:visible');
  for (const amount of [1, 2, 3]) {
    await match
      .getByRole('button', { name: 'Blue add ' + amount + ' points', exact: true })
      .click();
    assert.equal(await match.locator('.pss-score').first().innerText(), String(2 + amount));
    await match
      .getByRole('button', { name: 'Blue remove ' + amount + ' points', exact: true })
      .click();
    assert.equal(await match.locator('.pss-score').first().innerText(), '2');
  }
  await match.getByRole('button', { name: 'Add Blue gam-jeom', exact: true }).click();
  assert.equal(await match.locator('.pss-score').nth(1).innerText(), '5');
  assert.match(await match.locator('.pss-blue .pss-gam-jeom-controls').innerText(), /Gam-jeoms: 1/);
  await match.getByRole('button', { name: 'Remove Blue gam-jeom', exact: true }).click();
  assert.equal(await match.locator('.pss-score').nth(1).innerText(), '4');
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.time),
    timeBeforeSwap
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('.leda-training').__vue__.gvi.game_state),
    3
  );
  await page
    .locator('.pss-audio-controls')
    .getByRole('button', { name: 'Equipment', exact: true })
    .click();
  await page.locator('.pss-inventory').waitFor();
  await page.bringToFront();
  await page.evaluate(() => window.OnVkEscape());
  await page.locator('.pss-competition .leda-courts:visible').waitFor();
  assert.equal(await page.locator('.leda-courts:visible .pss-court').count(), 1);
  assert.equal(await page.locator('.leda-courts:visible .pss-score').nth(1).innerText(), '4');
  // Run a complete best-of-three through timer, manual score, and penalty paths.
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.$parent.stopTimer();
    c.gvi.game[0].competition.remaining = 1;
    c.timer_callback();
  });
  assert.match(
    await match.locator('.pss-round-result').first().innerText(),
    /Round 1.*Sam Taylor.*PTF/
  );
  await page
    .locator('.pss-audio-controls')
    .getByRole('button', { name: 'Equipment', exact: true })
    .click();
  await page.locator('.pss-inventory').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.pss-competition .leda-courts:visible').waitFor();
  assert.equal(await match.locator('.pss-round-result').count(), 1);
  assert.equal(await match.locator('.pss-score').first().innerText(), '0');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.$parent.stopTimer();
    c.$parent.onAuthClientMessage('DevData', '000000000002,value:320');
  });
  await match.getByRole('button', { name: 'Blue add 3 points', exact: true }).click();
  await match.getByRole('button', { name: 'Blue add 1 points', exact: true }).click();
  assert.match(await match.locator('.pss-round-result').nth(1).innerText(), /Alex Live.*PTG/);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.evaluate(() => document.querySelector('.leda-training').__vue__.$parent.stopTimer());
  await match.getByRole('button', { name: 'Add Blue gam-jeom', exact: true }).click();
  await match.getByRole('button', { name: 'Add Blue gam-jeom', exact: true }).click();
  assert.match(await match.locator('.pss-round-result').nth(2).innerText(), /Sam Taylor.*PUN/);
  assert.match(await match.locator('.pss-series-outcome').innerText(), /Match winner: Red.*PTF/);
  assert.match(await match.locator('.pss-series-summary').innerText(), /Blue 1.*2 Red/);
  await tv
    .locator('#outcome')
    .getByText(/Red wins.*PTF/)
    .waitFor();
  assert.equal(await tv.locator('#results span').count(), 3);
  assert.equal(await tv.locator('#red-wins').innerText(), '2');
  await tv.screenshot({ path: path.join(artifacts, 'spectator-result.png') });
  // Reproduce the embedded engine's missing Grid, gap and modern font-size support.
  await tv.route('**/spectator.css*', async (route) => {
    const response = await route.fetch();
    const css = (await response.text())
      .replace(/font-size:\s*(?:min|clamp)\([^;]+;/g, '')
      .replace(/(?:display:\s*grid|grid-[^:;]+:[^;]+|gap:[^;]+);/g, '');
    await route.fulfill({ response, body: css });
  });
  await tv.reload();
  await tv.locator('#red-wins').getByText('2', { exact: true }).waitFor();
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 }
  ]) {
    await tv.setViewportSize(viewport);
    await tv.waitForFunction(() => {
      const blue = document.querySelector('.blue').getBoundingClientRect();
      const centre = document.querySelector('.match-centre').getBoundingClientRect();
      const red = document.querySelector('.red').getBoundingClientRect();
      const stage = document.querySelector('.scoreboard').getBoundingClientRect();
      return (
        blue.width < stage.width * 0.4 &&
        blue.right <= centre.left + 1 &&
        centre.right <= red.left + 1 &&
        red.right <= innerWidth + 1 &&
        blue.top >= 0 &&
        red.bottom <= innerHeight + 1 &&
        Math.abs(blue.top - red.top) < 1
      );
    });
  }
  await tv.setViewportSize({ width: 1920, height: 1080 });
  assert(
    (await tv.locator('#red-score').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >
      100
  );
  await tv.screenshot({ path: path.join(artifacts, 'spectator-legacy-fonts.png') });
  await page.screenshot({ path: path.join(artifacts, 'competition-series.png') });
  await match.getByRole('button', { name: 'Undo last round', exact: true }).click();
  await match.getByRole('button', { name: 'Remove Blue gam-jeom', exact: true }).click();
  await match.getByLabel('Result winner', { exact: true }).selectOption('left');
  await match.getByLabel('Win method', { exact: true }).selectOption('RSC');
  await match.getByRole('button', { name: 'Record result', exact: true }).click();
  assert.match(await match.locator('.pss-series-outcome').innerText(), /Match winner: Blue.*RSC/);
  await page.screenshot({ path: path.join(artifacts, 'competition.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Maximum gam-jeoms per round (1–99)', { exact: true }).fill('3');
  await page.getByLabel('Point gap (0 disables, maximum 999)', { exact: true }).fill('0');
  await page.getByLabel('Point gap (0 disables, maximum 999)', { exact: true }).press('Tab');
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.gameinfo.game_rounds = 5;
    c.gameinfo.rest_time = 5;
    c.gameinfo.game_type = 'Grand Slam Rules';
  });
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await match.getByRole('button', { name: 'Reset match', exact: true }).click();
  assert.match(
    await match.locator('.pss-series-summary').innerText(),
    /Gam-jeom limit 3.*Point gap off/
  );
  assert.match(await match.locator('.pss-series-summary').innerText(), /Best of 5/);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.evaluate(() => document.querySelector('.leda-training').__vue__.$parent.stopTimer());
  for (let i = 0; i < 4; i++)
    await match.getByRole('button', { name: 'Blue add 3 points', exact: true }).click();
  assert.equal(await match.locator('.pss-round-result').count(), 0);
  assert.equal(await match.locator('.pss-score').first().innerText(), '12');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.querySelector('.leda-training').__vue__.gvi.game[0].competition.phase
    ),
    'paused'
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.gvi.game[0].competition.remaining = 1;
    c.timer_callback();
    c.$parent.stopTimer();
  });
  await tv.locator('#phase').getByText('Break', { exact: true }).waitFor();
  await tv.locator('#clock').getByText('00:05', { exact: true }).waitFor();
  assert.equal(await tv.locator('#clock').innerText(), '00:05');
  await tv
    .locator('#outcome')
    .getByText(/Blue wins.*PTF/)
    .waitFor();
  await match.getByLabel('Result winner', { exact: true }).selectOption('right');
  await match.getByLabel('Win method', { exact: true }).selectOption('SUP');
  await match.getByRole('button', { name: 'Update previous round', exact: true }).click();
  await tv
    .locator('#outcome')
    .getByText(/Red wins.*SUP/)
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.querySelector('.leda-training').__vue__.gvi.game[0].competition.breakRemaining
    ),
    5
  );
  await tv.screenshot({ path: path.join(artifacts, 'spectator-break.png') });
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    for (let i = 0; i < 5; i++) c.timer_callback();
  });
  assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.$parent.stopTimer();
    c.gvi.game[0].competition.remaining = 9.75;
    c.gvi.game[0].competition.phase = 'paused';
    c.gameControl();
  });
  await tv.waitForFunction(() => /^09:\d{3}$/.test(document.getElementById('clock').textContent));
  await page.waitForFunction(() =>
    /^09:\d{3}$/.test(document.querySelector('.leda-training').__vue__.gvi.time_str)
  );
  const preciseClock = await tv.locator('#clock').innerText();
  await tv.waitForFunction(
    (previous) => document.getElementById('clock').textContent !== previous,
    preciseClock
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.equal(await tv.locator('#blue-leading').isVisible(), true);
  assert.equal(await tv.locator('#red-leading').isVisible(), true);
  assert.equal(await match.locator('.pss-leader-light').first().isVisible(), true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await match
    .getByRole('button', { name: 'Raise court 1 threshold', exact: true })
    .scrollIntoViewIfNeeded();
  const thresholdBox = await match
    .getByRole('button', { name: 'Raise court 1 threshold', exact: true })
    .boundingBox();
  const footerBox = await page.locator('.leda-training-controls').boundingBox();
  assert(thresholdBox.y + thresholdBox.height <= footerBox.y);
  await page.screenshot({ path: path.join(artifacts, 'competition-laptop.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await match.getByRole('button', { name: 'Reset match', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    c.gvi.game[0].competition.remaining = 1;
    c.timer_callback();
    c.$parent.stopTimer();
  });
  await tv
    .locator('#outcome')
    .getByText(/SUP.*Undecided/)
    .waitFor();
  await tv.locator('#clock').getByText('00:05', { exact: true }).waitFor();
  await tv.screenshot({ path: path.join(artifacts, 'spectator-undecided-sup.png') });
  await page.evaluate(() => {
    const c = document.querySelector('.leda-training').__vue__;
    for (let i = 0; i < 5; i++) c.timer_callback();
  });
  await tv
    .locator('#outcome')
    .getByText(/SUP.*Undecided/)
    .waitFor();
  await match.getByRole('button', { name: 'Award Red SUP', exact: true }).click();
  assert.match(await match.locator('.pss-round-result').first().innerText(), /Sam Taylor.*SUP/);
  await page.getByRole('button', { name: 'Protector test', exact: true }).click();
  await page.locator('.pss-competition-setup').waitFor();
  await tv.locator('.scoreboard.testing').waitFor();
  assert.equal(await page.evaluate(() => window.PSS_MODES.isCompetition()), false);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await tv
    .locator('#test-mode-status')
    .getByText(/Panel disconnected/)
    .waitFor();
  assert.deepEqual(tvSockets, []);
  await tv.close();
  await page.evaluate(() =>
    document.getElementById('id_home').__vue__.$parent.onClientState(false)
  );
}

async function verifyMenuSettings(page, artifacts) {
  await page.evaluate(() => {
    const host = document.getElementById('id_home').__vue__.$parent;
    window._menuReceiverClient = host.mqtt_client;
    host.mqtt_client = { connected: true, subscribe() {}, publish() {}, end() {} };
    host.onClientState(true);
    window.OnConnectEvent(0);
  });
  await page.getByText('Receiver online', { exact: true }).waitFor();
  await page.evaluate(() =>
    document.getElementById('id_home').__vue__.$parent.onClientState(false)
  );
  await page.getByText('Receiver offline', { exact: true }).waitFor();
  await page.evaluate(() => {
    document.getElementById('id_home').__vue__.$parent.mqtt_client = window._menuReceiverClient;
    delete window._menuReceiverClient;
  });
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  assert.equal(await menu.getByRole('button').count(), 5);
  const competition = await menu
    .getByRole('button', { name: 'Competition', exact: true })
    .boundingBox();
  const court = await menu
    .getByRole('button', { name: 'Court Training', exact: true })
    .boundingBox();
  assert(court.y > competition.y + competition.height);
  await menu.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.pss-settings').waitFor();
  await page.getByLabel('Round duration in seconds (1–36000)', { exact: true }).fill('90');
  await page.getByLabel('Rounds (1–99)', { exact: true }).fill('3');
  await page.getByLabel('Break duration in seconds (0–3600)', { exact: true }).fill('0');
  await page.getByLabel('Maximum gam-jeoms per round (1–99)', { exact: true }).fill('2');
  await page.getByLabel('Point gap (0 disables, maximum 999)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save match settings', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('xlgame_info')).game_time),
    90
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('xlgame_info')).competition_point_gap
    ),
    0
  );
  await page.getByLabel('Point gap (0 disables, maximum 999)', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save match settings', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('xlgame_info')).competition_max_gam_jeom
    ),
    2
  );
  await page.getByLabel('Helmet threshold (0–71)', { exact: true }).fill('72');
  await page.getByRole('button', { name: 'Save match settings', exact: true }).click();
  await page.getByText(/Check the match settings/).waitFor();
  assert.notEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('xlgame_info')).toukui_gate),
    72
  );
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main menu' }).waitFor();
  await page.setViewportSize({ width: 640, height: 480 });
  await page.screenshot({ path: path.join(artifacts, 'home-small.png') });
  const small = await menu.boundingBox();
  assert(
    small.x >= 0 && small.y >= 0 && small.x + small.width <= 640 && small.y + small.height <= 480
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    let file = path.resolve(
      web,
      '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    );
    if (!path.extname(file)) file = path.join(web, 'index.html');
    if (!file.startsWith(web + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.routeWebSocket('**', (socket) => socket.close());
    const errors = [];
    const imageRequests = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'image') imageRequests.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.stack));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.addInitScript(() => {
      const rows = [
        {
          index: 1,
          name: 'Alex Morgan',
          weight: 58,
          court: 1,
          toukui: '000000000011',
          huju: '000000000001'
        },
        {
          index: 2,
          name: 'Sam Taylor',
          weight: 62,
          court: 1,
          toukui: '000000000012',
          huju: '000000000002'
        },
        {
          index: 3,
          name: 'Jordan Lee',
          weight: 54,
          court: 2,
          toukui: '000000000013',
          huju: '000000000003'
        },
        {
          index: 4,
          name: 'Casey Brown',
          weight: 60,
          court: 2,
          toukui: '000000000014',
          huju: '000000000004'
        }
      ];
      localStorage.setItem(
        'xlgame_settings',
        JSON.stringify({ changci_begin: 0, changci_end: 4, game_begin: 0, game_end: 4, extra: '' })
      );
      const equipment = [];
      rows.forEach((row) => {
        equipment.push({
          id: row.huju,
          type: 'body',
          colour: '',
          size: '',
          order: equipment.length + 1
        });
        equipment.push({
          id: row.toukui,
          type: 'helmet',
          colour: '',
          size: '',
          order: equipment.length + 1
        });
      });
      localStorage.setItem(
        'uobtkd_equipment_v1',
        JSON.stringify({ records: equipment, counters: {} })
      );
      for (let court = 0; court < 16; court++) {
        function slot() {
          return {
            index: '',
            gamer: '',
            huju: '',
            toukui: '',
            score: 0,
            tkhits: 0,
            hjhits: 0,
            valid: 0,
            warning: 0,
            last_hit: null
          };
        }
        const game = { lidu: 8, left: slot(), right: slot() };
        rows
          .filter((row) => row.court === court + 1)
          .forEach((row, index) => {
            game[index === 0 ? 'left' : 'right'] = {
              ...slot(),
              index: court * 2 + index,
              gamer: row.name,
              huju: row.huju,
              toukui: row.toukui
            };
          });
        localStorage.setItem(court + '_changdi_data', JSON.stringify(game));
      }
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/');
    await page.getByRole('button', { name: 'Court Training', exact: true }).waitFor();
    assert.equal(/[\u4e00-\u9fff]/.test(await page.locator('body').innerText()), false);
    await page
      .getByRole('heading', { name: 'UoBTKD Electronic Training Suite', exact: true })
      .waitFor();
    const homeBox = await page.locator('.pss-home').boundingBox();
    const headingBox = await page.locator('.pss-home h1').boundingBox();
    assert.ok(Math.abs(headingBox.x + headingBox.width / 2 - homeBox.width / 2) < 2);
    assert.ok(headingBox.y > 150 && headingBox.y < 500);
    assert.equal(await page.title(), 'UoBTKD Training Suite');
    await page.screenshot({ path: path.join(artifacts, 'home.png') });
    await page.evaluate(() => {
      window.__menuNativeLookups = 0;
      window.HostGetServerInfo = window.HostGetUserInfo = function () {
        window.__menuNativeLookups++;
        throw new Error('Menu must use startup configuration');
      };
    });
    await verifyMenuSettings(page, artifacts);
    await verifyEquipment(page, artifacts);
    await verifyFreeTraining(page, artifacts);
    await verifyCompetition(page, artifacts);
    await page.getByRole('button', { name: 'Court Training', exact: true }).click();
    await page.locator('.leda-courts:visible').waitFor();
    assert.equal(await page.locator('.pss-inventory').count(), 0);
    await page
      .locator('.pss-audio-controls')
      .getByRole('button', { name: 'Equipment', exact: true })
      .click();
    await page
      .locator('.pss-inventory')
      .waitFor({ timeout: 10000 })
      .catch(async (error) => {
        await page.screenshot({ path: path.join(artifacts, 'failure.png') });
        console.log(await page.locator('body').innerText());
        console.log(errors);
        throw error;
      });
    assert.equal(await page.locator('.pss-inventory-table tbody tr').count(), 9);
    assert.equal(/[\u4e00-\u9fff]/.test(await page.locator('body').innerText()), false);
    await page.screenshot({ path: path.join(artifacts, 'athletes.png') });
    // Home stays clickable even with the fixed audio toolbar present.
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Free Training', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Court Training', exact: true }).click();
    await page.locator('.leda-courts:visible').waitFor();
    await page.evaluate(() => {
      window.LEDA_SENSOR_MONITOR.receive('000000000002,value:2865');
      window.LEDA_SENSOR_MONITOR.receive('000000000003,value:582');
    });
    await page
      .locator('.leda-courts:visible')
      .getByText('Body: 2865 raw (L71.63)', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.leda-courts:visible .pss-court').count(), 4);
    assert.equal(await page.locator('.leda-courts:visible .pss-score:visible').count(), 8);
    assert.equal(await page.locator('.leda-courts:visible .pss-score').first().innerText(), '0');
    await page.screenshot({ path: path.join(artifacts, 'courts.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const teamName = page.getByRole('textbox', { name: 'Team Name', exact: true });
    await teamName.fill('North London Club');
    await page.evaluate(() => window.OnVkSpace());
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isVisible(), true);
    const editingName = await teamName.evaluate((input) => {
      let current = input.closest('#myModal');
      while (current && !current.__vue__) current = current.parentElement;
      return current.__vue__.gameinfo.game_name;
    });
    assert.equal(editingName, 'North London Club');
    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('xlgame_info')).game_name),
      'North London Club'
    );
    await page.getByText('North London Club', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await teamName.inputValue(), 'North London Club');
    await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sensor levels', exact: true }).click();
    await page.getByRole('dialog', { name: 'Sensor levels' }).waitFor();
    await page.evaluate(() => window.OnVkSpace());
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isVisible(), true);
    await page.getByText('Meets threshold', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.leda-threshold-field input').count(), 3);
    await page.locator('.leda-threshold-field input').first().fill('71');
    await page.locator('.leda-threshold-field input').first().press('Tab');
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('0_changdi_data')).lidu
    );
    assert.equal(saved, 71);
    assert.equal(/[\u4e00-\u9fff]/.test(await page.locator('body').innerText()), false);
    await page.screenshot({ path: path.join(artifacts, 'sensors.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').isVisible(), false);
    assert.equal(
      await page
        .getByRole('button', { name: 'Sensor levels', exact: true })
        .evaluate((el) => el === document.activeElement),
      true
    );
    await page.getByRole('button', { name: 'Sensor levels', exact: true }).click();
    await page.getByRole('button', { name: 'Listen for hits', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/Receiver offline/)
      .waitFor();
    await page.getByRole('button', { name: 'Close sensor levels' }).click();
    // Check the denser layout at a laptop viewport.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(artifacts, 'courts-laptop.png') });
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    for (const count of [1, 8, 16]) {
      await page.locator('.dropdown-toggle').click();
      await page
        .locator('.dropdown-item')
        .getByText('Courts × ' + count, { exact: true })
        .click();
      await page.locator('.leda-courts:visible').waitFor();
      assert.equal(await page.locator('.leda-courts:visible .pss-court').count(), count);
      assert.equal(
        await page.locator('.leda-courts:visible .pss-score:visible').count(),
        count * 2
      );
      await page.screenshot({ path: path.join(artifacts, 'courts-' + count + '.png') });
    }
    const courtPopup = page.waitForEvent('popup');
    await page
      .getByRole('button', { name: 'Open spectator window', exact: true })
      .filter({ visible: true })
      .click();
    const courtTV = await courtPopup;
    await courtTV.locator('.scoreboard.training').waitFor();
    await courtTV.waitForFunction(() => document.querySelectorAll('.training-card').length === 16);
    assert.equal(await courtTV.locator('.training-person').count(), 32);
    await page.evaluate(() => {
      const v = document.querySelector('.leda-training').__vue__;
      v.setParticipantName(0, 'left', 'Training Blue');
      v.gvi.game[0].left.score = 7;
    });
    await courtTV
      .locator('.training-person h2')
      .getByText('Training Blue', { exact: true })
      .waitFor();
    assert.equal(await courtTV.locator('.training-person strong').first().innerText(), '7');
    assert.equal(await courtTV.locator('.side-totals').first().isVisible(), false);
    await courtTV.screenshot({ path: path.join(artifacts, 'spectator-courts.png') });
    await page
      .getByRole('button', { name: 'Close spectator window', exact: true })
      .filter({ visible: true })
      .click();
    await courtTV.waitForEvent('close');
    assert.equal(await page.evaluate(() => window.__menuNativeLookups), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(imageRequests, []);
    console.log(
      'Browser checks passed: equipment labels, battery responses, hidden IDs, all-screen equipment access, one-court competition scoring/pause, restored training setup, free training, thresholds, and laptop layouts.'
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
