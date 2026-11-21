(function (root) {
  'use strict';
  class CameraMP4 {
    constructor(output) {
      this.output = output;
      this.pending = new Uint8Array(0);
      this.ftyp = null;
      this.moov = null;
      this.moof = null;
      this.initialized = false;
    }
    push(bytes) {
      if (this.pending.length + bytes.length > 8 * 1024 * 1024)
        throw new Error(
          'The camera did not produce streamable MP4. Update Safari/iOS to 18.4 or newer.'
        );
      this.pending = CameraMP4.join(this.pending, bytes);
      let at = 0;
      while (this.pending.length - at >= 8) {
        const view = new DataView(this.pending.buffer, this.pending.byteOffset + at);
        let size = view.getUint32(0),
          header = 8;
        const type = String.fromCharCode(...this.pending.subarray(at + 4, at + 8));
        if (size === 1) {
          if (this.pending.length - at < 16) break;
          size = Number(view.getBigUint64(8));
          header = 16;
        }
        if (size === 0 || size < header || size > 8 * 1024 * 1024)
          throw new Error(
            'This browser did not produce fragmented MP4. Update Safari/iOS to 18.4 or newer.'
          );
        if (size > this.pending.length - at) break;
        const box = this.pending.slice(at, at + size);
        if (type === 'ftyp') {
          if (this.initialized || this.ftyp)
            throw new Error('The camera unexpectedly restarted its MP4 stream.');
          this.ftyp = box;
        }
        if (type === 'moov') {
          if (this.initialized || this.moov)
            throw new Error('The camera unexpectedly restarted its MP4 stream.');
          this.moov = box;
        }
        if (!this.initialized && this.ftyp && this.moov) {
          this.initialized = true;
          this.output(CameraMP4.join(this.ftyp, this.moov));
          this.ftyp = this.moov = null;
        }
        if (type === 'moof') {
          if (!this.initialized || this.moof) throw new Error('Camera fragments are incomplete.');
          this.moof = box;
        }
        if (type === 'mdat') {
          if (!this.moof)
            throw new Error(
              'The browser produced ordinary MP4 instead of fragmented MP4. Update Safari/iOS to 18.4 or newer.'
            );
          this.output(CameraMP4.join(this.moof, box));
          this.moof = null;
        }
        at += size;
      }
      this.pending = this.pending.slice(at);
    }
    finish() {
      if (!this.initialized || this.pending.length || this.moof)
        throw new Error(
          'The camera ended with incomplete MP4 data. Keep Safari open until recording finishes.'
        );
    }
    static join(a, b) {
      const result = new Uint8Array(a.length + b.length);
      result.set(a);
      result.set(b, a.length);
      return result;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = CameraMP4;
  else root.CameraMP4 = CameraMP4;
})(typeof window !== 'undefined' ? window : globalThis);
