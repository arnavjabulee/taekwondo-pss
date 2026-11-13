function boxes(data, start = 0, end = data.length) {
  const result = [];
  for (let at = start; at < end;) {
    if (at + 8 > end) throw new Error('Incomplete MP4 box');
    let size = data.readUInt32BE(at),
      header = 8;
    if (size === 1) {
      if (at + 16 > end) throw new Error('Incomplete MP4 box');
      size = Number(data.readBigUInt64BE(at + 8));
      header = 16;
    }
    if (size < header || at + size > end) throw new Error('Invalid MP4 box length');
    result.push({
      type: data.toString('ascii', at + 4, at + 8),
      at,
      start: at + header,
      end: at + size
    });
    at += size;
  }
  return result;
}
function child(data, parent, type, skip = 0) {
  const value = boxes(data, parent.start + skip, parent.end).find((b) => b.type === type);
  if (!value) throw new Error('Missing MP4 ' + type);
  return value;
}
function initialization(data) {
  const top = boxes(data),
    moov = top.find((b) => b.type === 'moov');
  if (
    !top.some((b) => b.type === 'ftyp') ||
    !moov ||
    top.some((b) => !['ftyp', 'moov', 'free'].includes(b.type))
  )
    throw new Error('Camera must send an fMP4 initialization segment');
  const trak = child(data, moov, 'trak'),
    mdia = child(data, trak, 'mdia'),
    mdhd = child(data, mdia, 'mdhd');
  const timescale = data.readUInt32BE(mdhd.start + (data[mdhd.start] === 1 ? 20 : 12));
  const trex = child(data, child(data, moov, 'mvex'), 'trex');
  const stsd = child(data, child(data, child(data, mdia, 'minf'), 'stbl'), 'stsd');
  const entry = boxes(data, stsd.start + 8, stsd.end)[0];
  if (!entry || !['avc1', 'avc3'].includes(entry.type) || !timescale)
    throw new Error('Replay requires H.264 fragmented MP4');
  const avcc = child(data, entry, 'avcC', 78);
  const codec =
    entry.type +
    '.' +
    data
      .subarray(avcc.start + 1, avcc.start + 4)
      .toString('hex')
      .toUpperCase();
  return { timescale, defaultDuration: data.readUInt32BE(trex.start + 12), codec };
}
function fragment(data, init) {
  const top = boxes(data),
    moof = top.find((b) => b.type === 'moof');
  if (
    !moof ||
    !top.some((b) => b.type === 'mdat') ||
    top.filter((b) => b.type === 'moof').length !== 1
  )
    throw new Error('Invalid fMP4 media fragment');
  const traf = child(data, moof, 'traf'),
    tfdt = child(data, traf, 'tfdt'),
    tfhd = child(data, traf, 'tfhd');
  const decode =
    data[tfdt.start] === 1
      ? Number(data.readBigUInt64BE(tfdt.start + 4))
      : data.readUInt32BE(tfdt.start + 4);
  const flags = data.readUInt32BE(tfhd.start) & 0xffffff;
  let at = tfhd.start + 8;
  if (flags & 1) at += 8;
  if (flags & 2) at += 4;
  const defaultDuration = flags & 8 ? data.readUInt32BE(at) : init.defaultDuration;
  let duration = 0,
    frames = 0;
  const frameTimes = [];
  for (const trun of boxes(data, traf.start, traf.end).filter((b) => b.type === 'trun')) {
    const f = data.readUInt32BE(trun.start) & 0xffffff,
      n = data.readUInt32BE(trun.start + 4);
    let p = trun.start + 8;
    if (n > 1000) throw new Error('Too many samples');
    if (f & 1) p += 4;
    if (f & 4) p += 4;
    for (let i = 0; i < n; i++) {
      const frameStart = decode + duration;
      duration += f & 0x100 ? data.readUInt32BE(p) : defaultDuration;
      if (f & 0x100) p += 4;
      if (f & 0x200) p += 4;
      if (f & 0x400) p += 4;
      const composition =
        f & 0x800 ? (data[trun.start] === 1 ? data.readInt32BE(p) : data.readUInt32BE(p)) : 0;
      frameTimes.push((frameStart + composition) / init.timescale);
      if (f & 0x800) p += 4;
    }
    if (p > trun.end) throw new Error('Truncated sample table');
    frames += n;
  }
  if (!duration || !frames || !Number.isSafeInteger(decode))
    throw new Error('Missing media timestamps');
  return {
    start: decode / init.timescale,
    end: (decode + duration) / init.timescale,
    frames,
    frameTimes,
    decode
  };
}
function rebase(data, ticks) {
  const copy = Buffer.from(data);
  for (const moof of boxes(copy).filter((b) => b.type === 'moof'))
    for (const traf of boxes(copy, moof.start, moof.end).filter((b) => b.type === 'traf')) {
      const tfdt = child(copy, traf, 'tfdt');
      if (copy[tfdt.start] === 1)
        copy.writeBigUInt64BE(copy.readBigUInt64BE(tfdt.start + 4) - BigInt(ticks), tfdt.start + 4);
      else copy.writeUInt32BE(copy.readUInt32BE(tfdt.start + 4) - ticks, tfdt.start + 4);
    }
  return copy;
}
function wrap(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, data]);
}
function normalize(data, decodeStart = 0) {
  const top = boxes(data),
    moof = top.find((b) => b.type === 'moof'),
    mdat = top.find((b) => b.type === 'mdat');
  if (!moof || !mdat) throw new Error('Missing video fragment');
  const moofChildren = boxes(data, moof.start, moof.end),
    trafs = moofChildren.filter((b) => b.type === 'traf');
  if (trafs.length !== 1) throw new Error('One H.264 video track is required');
  const children = boxes(data, trafs[0].start, trafs[0].end),
    tfhd = children.find((b) => b.type === 'tfhd');
  if (!tfhd) throw new Error('Missing track fragment header');
  const flags = data.readUInt32BE(tfhd.start) & 0xffffff;
  const header = Buffer.concat([
    data.subarray(tfhd.start, tfhd.start + 8),
    data.subarray(tfhd.start + 8 + (flags & 1 ? 8 : 0), tfhd.end)
  ]);
  header.writeUInt32BE((flags & ~1) | 0x020000, 0);
  const oldDecode = children.find((b) => b.type === 'tfdt');
  const ticks = oldDecode
    ? data[oldDecode.start] === 1
      ? Number(data.readBigUInt64BE(oldDecode.start + 4))
      : data.readUInt32BE(oldDecode.start + 4)
    : decodeStart;
  const time = Buffer.alloc(12);
  time.writeUInt32BE(0x01000000);
  time.writeBigUInt64BE(BigInt(ticks), 4);
  const runs = children
    .filter((b) => b.type === 'trun')
    .map((b) => Buffer.from(data.subarray(b.at, b.end)));
  if (runs.length !== 1) throw new Error('One sample run per fragment is required');
  function movie() {
    const track = wrap('traf', Buffer.concat([wrap('tfhd', header), wrap('tfdt', time), ...runs]));
    return wrap(
      'moof',
      Buffer.concat([
        ...moofChildren.filter((b) => b.type !== 'traf').map((b) => data.subarray(b.at, b.end)),
        track
      ])
    );
  }
  let result = movie();
  if (!(runs[0].readUInt32BE(8) & 1)) throw new Error('Missing video sample offset');
  runs[0].writeInt32BE(result.length + 8, 16);
  result = movie();
  return Buffer.concat([result, data.subarray(mdat.at, mdat.end)]);
}
module.exports = { boxes, initialization, fragment, rebase, normalize };
