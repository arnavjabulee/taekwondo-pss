"""Verify the staged native shell without launching another training session."""

from pathlib import Path
import ctypes

from prepare_native import TEXT, patch_bytes, patch_splash_dialog
import json
import struct
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1]
source = next((root / "vendor-source").glob("*.exe"))
app_name = json.loads((root / "src/app.json").read_text(encoding="utf-8"))["name"]
prepared = root / "UoBTKD Training Suite/native-update" / (app_name + '.exe')
original = source.read_bytes()
modified = prepared.read_bytes()
assert b'level="requireAdministrator"' in original
assert b'level="requireAdministrator"' not in modified
assert b'level="asInvoker"' in modified
popup_anchor=bytes.fromhex('6a006a00ff1540ad41008bf0')
assert original.count(popup_anchor)==1
popup_site=original.index(popup_anchor)
assert modified[popup_site:popup_site+len(popup_anchor)]==bytes.fromhex('6a006a01ff1540ad41008bf0')
assert b'HostCloseDisplay\0' in modified and b'HostFocusDisplay\0' in modified
app_name = json.loads((root / "src/app.json").read_text(encoding="utf-8"))["name"]
assert (app_name + "\0").encode("utf-16-le") in modified
# Verify both native title constructors, not only the initial window caption.
pe = struct.unpack_from("<I", original, 60)[0]
section_count = struct.unpack_from("<H", original, pe + 6)[0]
optional_size = struct.unpack_from("<H", original, pe + 20)[0]
image_base = struct.unpack_from("<I", original, pe + 24 + 28)[0]
sections = {}
for index in range(section_count):
    header = pe + 24 + optional_size + index * 40
    name = original[header : header + 8].rstrip(b"\0")
    virtual_size, rva, size, raw = struct.unpack_from("<IIII", original, header + 8)
    sections[name] = (rva, size, raw)
rva, size, raw = sections[b".rdata"]
title_offset = modified.index((app_name + "\0").encode("utf-16-le"))
title_address = image_base + rva + title_offset - raw
_, text_size, text_raw = sections[b".text"]
original_code = original[text_raw : text_raw + text_size]
bind_anchor=bytes.fromhex('688034400068d0304100ff15ccad4100')
bind_site=original.index(bind_anchor)+10
assert modified[bind_site]==0xe9 and modified[bind_site+5]==0x90
trampoline_va=image_base+sections[b'.text'][0]+bind_site-text_raw+5+struct.unpack_from('<i',modified,bind_site+1)[0]
trampoline=text_raw+trampoline_va-image_base-sections[b'.text'][0]
assert modified[trampoline:trampoline+6]==bytes.fromhex('ff15ccad4100')
for index,label in enumerate([b'HostCloseDisplay\0',b'HostFocusDisplay\0']):
    registration=trampoline+6+index*21
    assert modified[registration:registration+3]==bytes.fromhex('6a0068')
    callback_va=struct.unpack_from('<I',modified,registration+3)[0]
    name_va=struct.unpack_from('<I',modified,registration+8)[0]
    name_offset=raw+name_va-image_base-rva
    assert modified[name_offset:name_offset+len(label)]==label
    callback=text_raw+callback_va-image_base-sections[b'.text'][0]
    body=modified[callback:callback+(72 if index==0 else 89)]
    assert body.startswith(bytes.fromhex('5651ff15a8ae410083c40450ff154cad410083c4048bf0'))
    assert bytes.fromhex('a90000c04075') in body # Reject captioned/child panel windows.
    if index==0:assert bytes.fromhex('85f674') in body # Never post a thread-wide close for HWND_NULL.
    assert bytes.fromhex('ff152cf74000') in body if index==0 else bytes.fromhex('ff155cf04000') in body
back=trampoline+48
assert modified[back]==0xe9
assert back+5+struct.unpack_from('<i',modified,back+1)[0]==bind_site+6
for old_title in ["\u4f53\u80b2\u7ade\u8d5b\u8f6f\u4ef6 (\u5357\u4eac\u672c\u667a\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8)", "\u4f53\u80b2\u7ade\u8d5b\u8f6f\u4ef6"]:
    old_offset = original.index((old_title + "\0").encode("utf-16-le"))
    old_address = image_base + rva + old_offset - raw
    anchor = b"\x68" + struct.pack("<I", old_address)
    assert original_code.count(anchor) == 1
    reference = text_raw + original_code.index(anchor)
    assert modified[reference : reference + 5] == b"\x68" + struct.pack(
        "<I", title_address
    )
assert " [Offline]".encode("utf-16-le") not in modified
poll_anchor=bytes.fromhex('83bdac000000018bf18975ec0f859a010000')
poll_site=original.index(poll_anchor)+12
poll_target=poll_site+6+struct.unpack_from('<i',original,poll_site+2)[0]
assert modified[poll_site]==0xe9 and modified[poll_site+5]==0x90
assert poll_site+5+struct.unpack_from('<i',modified,poll_site+1)[0]==poll_target
assert modified[poll_target:poll_target+8]==original[poll_target:poll_target+8]
alt_anchor = b"\x81\x7b\x04\x04\x01\x00\x00\x75\x49\x8b\x35"
alt_site = original.index(alt_anchor)
assert modified[alt_site] == 0xE9
destination = alt_site + 5 + struct.unpack_from("<i", modified, alt_site + 1)[0]
assert modified[destination : destination + 7] == b"\x81\x7b\x04\x00\x01\x00\x00"
space_anchor = b"\x83\x7b\x08\x20\x75\x24"
space_site = original.index(space_anchor)
assert modified[space_site : space_site + len(space_anchor)] == space_anchor
space_start=space_site+len(space_anchor)
assert modified[space_start:space_start+36] == original[space_start:space_start+36]
escape_anchor=bytes.fromhex('837b081b0f85c2000000')
escape_start=original.index(escape_anchor)+len(escape_anchor)
guard=modified[escape_start:escape_start+33]
assert guard[:20]==bytes.fromhex('50518b033b4720741685c0740950ff1528f74000')
assert guard[20:27]==bytes.fromhex('ebee595831c0e9')
assert guard[31:]==bytes.fromhex('5958')
# The foreign-window branch returns FALSE, avoiding panel JS and MFC Cancel.
foreign_return=escape_start+31+struct.unpack_from('<i',guard,27)[0]
assert modified[foreign_return:foreign_return+9]==bytes.fromhex('5f5e5b8be55dc20400')
assert modified[escape_start+33:escape_start+42] == bytes.fromhex('f7430c000000400f85')
assert b'OnVkEscape\0' in modified
escape_bridge=escape_start+33+13
assert modified[escape_bridge:escape_bridge+7] == bytes.fromhex('8b87a800000068')
native_call_target=escape_bridge+33+struct.unpack_from('<i',modified,escape_bridge+29)[0]
assert native_call_target == space_start+33+struct.unpack_from('<i',original,space_start+29)[0]
for chinese in TEXT:
    if chinese.encode("utf-16-le") in original:
        assert chinese.encode("utf-16-le") not in modified, chinese
shell = ctypes.WinDLL("shell32")
shell.ExtractIconExW.argtypes = [
    ctypes.c_wchar_p,
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_uint,
]
assert shell.ExtractIconExW(str(prepared.resolve()), -1, None, None, 0) > 0
icon = (root / 'src/assets/app.ico').read_bytes()
_, _, count = struct.unpack_from('<HHH', icon)
for index in range(count):
    size, offset = struct.unpack_from('<II', icon, 6 + index * 16 + 8)
    assert icon[offset:offset + size] in modified, 'Custom icon image missing from native executable'
assert len(patch_bytes(original)) == len(original)
assert not (root / "UoBTKD Training Suite/notices/Vendor-Licence.txt").exists()
assert b'notices/Vendor-Licence.txt' not in modified
assert "\u4f53\u80b2\u7ade\u8d5b\u7c7b\u8f6f\u4ef6\u4f7f\u7528\u8bb8\u53ef\u534f\u8bae".encode('gbk') not in modified
source_splash = (root / 'src/assets/splash.png').read_bytes()
assert source_splash[:8] == b'\x89PNG\r\n\x1a\n'
width, height = struct.unpack_from('>II', source_splash, 16)
assert width >= 400 and height >= 260 and width * 13 == height * 20
with Image.open(root / 'src/assets/splash.png') as artwork, Image.open(root / 'UoBTKD Training Suite/res/splash.png') as installed:
    assert installed.mode == 'RGB'
    assert installed.size == (540, 351)
    expected = artwork.convert('RGB').resize((540, 351), Image.Resampling.LANCZOS)
    assert ImageChops.difference(expected, installed).getbbox() is None
splash_header = bytes.fromhex('0100ffff0000000000000000c808c0900100000000006801c700')
assert original.count(splash_header) == 1
splash_offset = original.index(splash_header)
splash_template = patch_splash_dialog(original[splash_offset:splash_offset + 96])
assert splash_template in modified
assert struct.unpack_from('<I', splash_template, 12)[0] & 0x00C00000 == 0
assert struct.unpack_from('<I', splash_template, 72)[0] & 0x240 == 0x40
print(
    "Native shell checks passed: standard-user manifest, translated labels, and app-only About text."
)

# Branded native library must retain the original engine bytes and be the exact load target.
import re
library_name = app_name + '.dll'
legacy_library = bytes.fromhex('4c65646153706f72742e646c6c').decode('ascii')
assert (root / 'UoBTKD Training Suite' / library_name).read_bytes() == (root / 'vendor-source' / legacy_library).read_bytes()
assert (library_name + '\0').encode('utf-16-le') in modified
assert not (root / 'UoBTKD Training Suite' / legacy_library).exists()
for item in (root / 'UoBTKD Training Suite').rglob('*'):
    assert not re.search(r'[\u3400-\u9fff]', item.name), str(item)
    assert not item.name.lower().startswith(bytes.fromhex('6c656461').decode('ascii')), str(item)
# Read Windows version fields through its resource API.
version = ctypes.WinDLL('version', use_last_error=True)
version.GetFileVersionInfoSizeW.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p]
version.GetFileVersionInfoW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p]
version.VerQueryValueW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_uint)]
size = version.GetFileVersionInfoSizeW(str(prepared), None)
assert size
buffer = ctypes.create_string_buffer(size)
assert version.GetFileVersionInfoW(str(prepared), 0, size, buffer)
for field in ['FileDescription','InternalName','ProductName']:
    pointer = ctypes.c_void_p(); length = ctypes.c_uint()
    assert version.VerQueryValueW(buffer, '\\StringFileInfo\\040904b0\\' + field, ctypes.byref(pointer), ctypes.byref(length))
    assert ctypes.wstring_at(pointer, length.value - 1) == app_name
print('Branding checks passed: native library, English filenames and Windows file properties.')
