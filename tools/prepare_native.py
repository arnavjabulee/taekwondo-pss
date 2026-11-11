"""Prepare a local, non-elevating shell; the original executable stays untouched.

Changes cover presentation, keyboard routing, detached display controls and
redundant connection-status polling. Receiver protocol, licence and
authentication code are preserved.
"""

import ctypes
import json
import struct
from pathlib import Path

TEXT = {
    "\u4f53\u80b2\u7ade\u8d5b\u8f6f\u4ef6 (\u5357\u4eac\u672c\u667a\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8)": "Training",
    "\u5357\u4eac\u672c\u667a\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8 (\u7248\u6743\u6240\u6709)": "Vendor software",
    "\u5357\u4eac\u672c\u667a\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8": "",
    "\u4f53\u80b2\u7ade\u8d5b\u8f6f\u4ef6": "Train",
    "\u5173\u4e8e&\u7248\u6743(About&License)": "About",
    "\u7248\u6743\u8bf4\u660e(License)": "About",
    "\u7cfb\u7edf\u8bbe\u7f6e(Setup)": "Settings",
    "\u4e91\u7aef\u8bbe\u7f6e(Cloud)": "Server",
    "\u7248\u672c\u5347\u7ea7(Upgrade)": "Update",
    "\u786e\u5b9a(Confirm)": "OK",
    "\u53d6\u6d88(Cancel)": "Cancel",
    "\u53d6\u6d88(Exit)": "Exit",
    "\u5730\u5740(Server)": "Server",
    "\u8d26\u53f7(Account)": "Account",
    "\u5e10\u53f7(Account)": "Account",
    "\u5bc6\u7801(password)": "Password",
    "\u8bed\u8a00(Language)": "Language",
    "\u7b80\u4f53\u4e2d\u6587": "EN",
    "\u767b\u5f55": "OK",
    "\u4e91\u7aef\u8d5b\u4e8b": "Web",
    "\u5927\u5c4f\u663e\u793a\u7a97\u53e3": "Scores",
    "\u573a\u5730\u68c0\u5f55\u8868": "List",
    "\u53d1\u73b0\u65b0\u7248\u672c ": "Update",
    "\u5f53\u524d\u5df2\u662f\u6700\u65b0\u7248\u672c": "Current",
    "\u65b0\u7248\u672c\u5df2\u4e0b\u8f7d，\u8bf7\u91cd\u65b0\u542f\u52a8\u8f6f\u4ef6": "Restart app",
    "\u60a8\u672a\u767b\u5f55，\u8bf7\u5728\u8bbe\u8ba1\u754c\u9762\u8f93\u5165\u6ce8\u518c\u53f7\u548c\u5bc6\u7801": "Sign in to continue",
    "\\\u4e50\u6253\u6570\u636e\\": "\\Data\\",
    " [ \u6ca1\u6709\u8fde\u63a5\u4e3b\u673a ]": "",
}

TEXT.update({
    '\u6211\u540c\u610f(I Agree)': 'I agree',
    '\u5f00\u59cb\u5347\u7ea7(Upgrade)': 'Upgrade',
    '\u6ca1\u6709\u627e\u5230\u7f51\u7edc\u8bbe\u5907': 'Offline',
    'TKDGame - ' + bytes.fromhex('4c65646153706f7274').decode('ascii'): 'UoBTKD'
})

def version_resource():
    """English Windows file properties, independent of the vendor's metadata."""
    app_name = json.loads((Path(__file__).resolve().parents[1] / 'src/app.json').read_text(encoding='utf-8'))['name']
    def block(key, value=b'', children=(), text=False):
        data = bytearray(struct.pack('<HHH', 0, len(value)//2 if text else len(value), int(text)))
        data.extend((key + '\0').encode('utf-16-le'))
        data.extend(b'\0' * (-len(data) % 4))
        data.extend(value)
        for child in children:
            data.extend(b'\0' * (-len(data) % 4))
            data.extend(child)
        struct.pack_into('<H', data, 0, len(data))
        return bytes(data)
    strings = {'CompanyName':'University of Bristol Taekwondo', 'FileDescription': app_name,
        'InternalName': app_name, 'OriginalFilename': app_name + '.exe', 'ProductName':app_name,
        'FileVersion':'1.0.0.0', 'ProductVersion':'1.0.0.0'}
    entries = [block(key, (value+'\0').encode('utf-16-le'), text=True) for key,value in strings.items()]
    table = block('StringFileInfo', children=[block('040904b0',children=entries,text=True)],text=True)
    languages = block('VarFileInfo',children=[block('Translation', struct.pack('<HH',1033,1200))],text=True)
    fixed = struct.pack('<13I',0xfeef04bd,0x10000,0x10000,0,0x10000,0,0x3f,0,0x40004,1,0,0,0)
    return block('VS_VERSION_INFO', fixed, [table,languages])


def patch_title_and_shortcuts(data):
    """Use verified v2.02 integration anchors, never guessed instruction offsets."""
    data = bytearray(data)
    # Timer 1 only polls/prints adapter information and calls OnConnectEvent.
    # MQTT already supplies real connect/close events. Bypass this legacy path
    # (including its native network queries and title suffix formatting).
    poll=bytes.fromhex('83bdac000000018bf18975ec0f859a010000')
    if data.count(poll)!=1:raise ValueError('Unexpected native receiver polling timer')
    poll_site=data.index(poll)+12
    poll_default=poll_site+6+struct.unpack_from('<i',data,poll_site+2)[0]
    data[poll_site:poll_site+6]=b'\xe9'+struct.pack('<i',poll_default-poll_site-5)+b'\x90'
    # window.open creates a separate spectator web window. Use the engine's
    # documented borderless type; its rectangle comes from the screen-sized JS
    # window features. The main MFC panel and its dialogs are unaffected.
    popup = bytes.fromhex('6a006a00ff1540ad41008bf0')
    if data.count(popup) != 1:
        raise ValueError('Unexpected native popup-window constructor')
    popup_site = data.index(popup)
    data[popup_site + 3] = 1  # WKE_WINDOW_TYPE_TRANSPARENT (borderless)
    pe = struct.unpack_from("<I", data, 60)[0]
    section_count = struct.unpack_from("<H", data, pe + 6)[0]
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    image_base = struct.unpack_from("<I", data, pe + 24 + 28)[0]
    sections = {}
    for index in range(section_count):
        header = pe + 24 + optional_size + index * 40
        name = bytes(data[header : header + 8]).rstrip(b"\0")
        virtual_size, rva, size, raw = struct.unpack_from("<IIII", data, header + 8)
        sections[name] = (header, virtual_size, rva, size, raw)

    app_name = json.loads(
        (Path(__file__).resolve().parents[1] / "src/app.json").read_text(
            encoding="utf-8"
        )
    )["name"]
    title = (app_name + "\0").encode("utf-16-le")
    escape_argument = b'VK_ESCAPE\0'
    escape_callback = b'OnVkEscape\0'
    original_payload = title + escape_argument + escape_callback
    close_name=b'HostCloseDisplay\0'
    focus_name=b'HostFocusDisplay\0'
    user32_name='user32.dll\0'.encode('utf-16-le')
    foreground_name=b'SetForegroundWindow\0'
    payload = original_payload + close_name + focus_name + user32_name + foreground_name
    if len(payload) % 2:
        payload += b"\0"
    library_offset = len(payload)
    payload += (app_name + '.dll\0').encode('utf-16-le')
    quit_offset = len(payload)
    payload += b'HostQuit\0'
    old_title = "\u4f53\u80b2\u7ade\u8d5b\u8f6f\u4ef6 (\u5357\u4eac\u672c\u667a\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8)".encode("utf-16-le")
    old_offset = data.find(old_title)
    header, virtual_size, rva, size, raw = sections[b".rdata"]
    if old_offset < raw or old_offset >= raw + virtual_size:
        raise ValueError("Cannot identify native window title")
    position = (virtual_size + 15) & ~15
    if position + len(payload) > size or any(
        data[raw + position : raw + position + len(payload)]
    ):
        raise ValueError("No verified padding for full native app name")
    new_address = image_base + rva + position
    text_header, text_virtual, text_rva, text_size, text_raw = sections[b".text"]
    # Startup and connection-state updates construct titles from different strings.
    # Redirect both, so the first receiver event cannot restore the legacy name.
    for source_title in [old_title + b"\0", "\u4f53\u80b2\u7ade\u8d5b\u8f6f\u4ef6\0".encode("utf-16-le")]:
        source_offset = data.find(source_title)
        if source_offset < raw or source_offset >= raw + virtual_size:
            raise ValueError("Cannot identify native title source")
        old_address = image_base + rva + source_offset - raw
        anchor = b"\x68" + struct.pack("<I", old_address)
        code = bytes(data[text_raw : text_raw + text_size])
        if code.count(anchor) != 1:
            raise ValueError("Unexpected native title reference")
        reference = text_raw + code.index(anchor) + 1
        struct.pack_into("<I", data, reference, new_address)
    # Redirect the library path and native application identity to branded strings.
    for token, address in [
        (bytes.fromhex('6c00650064006100730070006f00720074002e0064006c006c000000'), new_address + library_offset),
        (bytes.fromhex('4c00650064006100530070006f00720074000000'), new_address)
    ]:
        old_position = data.find(token)
        if old_position < raw or old_position >= raw + virtual_size:
            raise ValueError('Cannot identify native application/library name')
        old_reference = struct.pack('<I', image_base + rva + old_position - raw)
        code = bytes(data[text_raw:text_raw + text_size])
        if code.count(old_reference) != 1:
            raise ValueError('Unexpected native application/library reference')
        reference = text_raw + code.index(old_reference)
        struct.pack_into('<I', data, reference, address)
        data[old_position:old_position + len(token)] = b'\0' * len(token)
    data[raw + position : raw + position + len(payload)] = payload
    struct.pack_into("<I", data, header + 8, position + len(payload))

    # Skip only the WM_SYSKEYDOWN branch that sends both Alt keys to OnVkSpace.
    alt = b"\x81\x7b\x04\x04\x01\x00\x00\x75\x49\x8b\x35"
    following = b"\x81\x7b\x04\x00\x01\x00\x00\x0f\x85\xcc\x00\x00\x00\x83\x7b\x08\x1b"
    if data.count(alt) != 1 or data.count(following) != 1:
        raise ValueError("Unexpected native keyboard handler")
    start = data.index(alt)
    end = data.index(following)
    if end - start != 82:
        raise ValueError("Native Alt handler layout changed")
    data[start : start + 7] = b"\xe9" + struct.pack("<i", end - start - 5) + b"\x90\x90"
    # Replace only Escape's fullscreen branch with the proven Space-to-JS bridge.
    # Consume Escape natively after dispatch so MFC cannot interpret it as Cancel.
    escape_check = end + 13
    if data[escape_check:escape_check + 10] != bytes.fromhex('837b081b0f85c2000000'):
        raise ValueError('Unexpected native Escape handler')
    escape_start = escape_check + 10
    default_handler = escape_check + 10 + struct.unpack_from('<i',data,escape_check + 6)[0]
    return_site = default_handler - 14
    if data[return_site:default_handler] != bytes.fromhex('b8010000005f5e5b8be55dc20400'):
        raise ValueError('Unexpected Escape return sequence')
    space_anchor = bytes.fromhex('837b08207524')
    if data.count(space_anchor) != 1:
        raise ValueError('Unexpected Space bridge')
    space_start = data.index(space_anchor) + len(space_anchor)
    bridge = bytearray(data[space_start:space_start + 36])
    if bridge[:7] != bytes.fromhex('8b87a800000068') or bridge[23] != 0xB8 or bridge[28] != 0xE8:
        raise ValueError('Unexpected native JavaScript dispatch')
    struct.pack_into('<I',bridge,7,new_address + len(title))
    struct.pack_into('<I',bridge,24,new_address + len(title) + len(escape_argument))
    target = space_start + 33 + struct.unpack_from('<i',bridge,29)[0]
    # The application message pump also sees keys for independent web windows.
    # Walk MSG.hwnd's parents and dispatch to panel JS only when it belongs to
    # this CWnd (the bundled MFC80U CWnd HWND member is verified at +0x20).
    # Other top-level windows return FALSE directly, letting their own DOM
    # receive Escape instead of invoking the panel's back-navigation handler.
    def raw_offset(address):
        for _, _, section_rva, section_size, section_raw in sections.values():
            if section_rva <= address < section_rva + section_size:
                return section_raw + address - section_rva
        raise ValueError('Native import RVA outside sections')
    imports = raw_offset(struct.unpack_from('<I',data,pe + 24 + 104)[0])
    get_parent = None
    while struct.unpack_from('<I',data,imports + 12)[0]:
        lookup, _, _, _, thunk = struct.unpack_from('<IIIII',data,imports)
        index = 0
        while True:
            entry = struct.unpack_from('<I',data,raw_offset(lookup or thunk) + index * 4)[0]
            if not entry: break
            if not entry & 0x80000000:
                symbol = raw_offset(entry) + 2
                if data[symbol:symbol + 10] == b'GetParent\0':
                    get_parent = image_base + thunk + index * 4
            index += 1
        imports += 20
    if get_parent != 0x40f728:
        raise ValueError('Unexpected GetParent import for native keyboard routing')
    guard = bytes.fromhex('50518b033b4720741685c0740950ff15') + struct.pack('<I',get_parent)
    guard += bytes.fromhex('ebee595831c0e9') + struct.pack('<i',return_site + 5 - (escape_start + 31)) + bytes.fromhex('5958')
    assert len(guard) == 33
    prefix = bytes.fromhex('f7430c000000400f85') + struct.pack('<i',return_site - escape_start - len(guard) - 13)
    struct.pack_into('<i',bridge,29,target - (escape_start + len(guard) + len(prefix) + 33))
    replacement = guard + prefix + bridge
    replacement += b'\xe9' + struct.pack('<i',return_site - (escape_start + len(replacement) + 5))
    data[escape_start:return_site] = replacement.ljust(return_site - escape_start,b'\x90')
    # Let the focused web view own Space. The original bridge also dispatched
    # Space to panel JS before the DOM saw it, causing double toggles and stuck
    # held-key state when native dialogs swallowed the release event.
    data[space_start - 2] = 0xeb  # JNE +36 -> JMP +36; keep its bridge for Escape.
    # Add real HWND close/focus commands for detached displays. window.close()
    # does not reliably reach this old engine's native window lifecycle.
    # Both callbacks reject child/captioned windows so the panel cannot be closed.
    close_address=new_address+len(original_payload)
    focus_address=close_address+len(close_name)
    module_address=focus_address+len(focus_name)
    foreground_address=module_address+len(user32_name)
    def display_callback(focus):
        code=bytearray.fromhex('5651ff15a8ae410083c40450ff154cad410083c4048bf0')
        fail_jumps=[]
        if not focus:
            code+=bytes.fromhex('85f674');fail_jumps.append(len(code));code.append(0)
        code+=bytes.fromhex('6af056ff15c0f64000a90000c04075')
        fail_jumps.append(len(code));code.append(0)
        if focus:
            code+=b'\x68'+struct.pack('<I',module_address)+bytes.fromhex('ff1588f0400085c074')
            fail_jumps.append(len(code));code.append(0)
            code+=b'\x68'+struct.pack('<I',foreground_address)+bytes.fromhex('50ff155cf0400085c074')
            fail_jumps.append(len(code));code.append(0)
            code+=bytes.fromhex('56ffd0')
        else:
            code+=bytes.fromhex('6a006a006a1056ff152cf74000')
        code+=bytes.fromhex('50eb');done_jump=len(code);code.append(0)
        fail=len(code);code+=bytes.fromhex('6a00')
        done=len(code);code+=bytes.fromhex('ff1540ae410083c4045ec3')
        for at in fail_jumps:code[at]=fail-at-1
        code[done_jump]=done-done_jump-1
        return bytes(code)
    close_code=display_callback(False)
    focus_code=display_callback(True)
    close_site=start+7
    if len(close_code)>end-close_site:
        raise ValueError('No verified keyboard padding for display close callback')
    close_va=image_base+text_rva+close_site-text_raw
    data[close_site:close_site+len(close_code)]=close_code
    text_position=(text_virtual+15)&~15
    focus_va=image_base+text_rva+text_position
    bind_anchor=bytes.fromhex('688034400068d0304100ff15ccad4100')
    if data.count(bind_anchor)!=1:raise ValueError('Unexpected native JS binding anchor')
    bind_site=data.index(bind_anchor)+10
    # Quit resolves the calling view's top-level HWND, then shares the proven
    # asynchronous WM_CLOSE tail. Null HWNDs return without posting a thread message.
    quit_site = text_raw + text_position + len(focus_code)
    quit_va = image_base + text_rva + quit_site - text_raw
    quit_code = bytearray(close_code[:23])
    quit_code += bytes.fromhex('85f60f84')
    fail_tail = close_va + close_code.rindex(bytes.fromhex('6a00ff1540ae4100'))
    quit_code += struct.pack('<i', fail_tail - (quit_va + len(quit_code) + 4))
    parent_loop = len(quit_code)
    quit_code += bytes.fromhex('56ff1528f7400085c074')
    send_jump = len(quit_code); quit_code.append(0)
    quit_code += bytes.fromhex('8bf0eb')
    quit_code.append((parent_loop - len(quit_code) - 1) & 255)
    quit_code[send_jump] = len(quit_code) - send_jump - 1
    close_tail = close_va + close_code.index(bytes.fromhex('6a006a006a1056ff152cf74000'))
    quit_code += b'\xe9' + struct.pack('<i', close_tail - (quit_va + len(quit_code) + 5))
    trampoline_site = escape_start + len(replacement)
    trampoline_va = image_base + text_rva + trampoline_site - text_raw
    trampoline=bytes.fromhex('ff15ccad4100')
    for callback,name in [(close_va,close_address),(focus_va,focus_address),(quit_va,new_address+quit_offset)]:
        trampoline+=b'\x6a\x00\x68'+struct.pack('<I',callback)+b'\x68'+struct.pack('<I',name)+bytes.fromhex('ff15ccad410083c40c')
    trampoline+=b'\xe9'+struct.pack('<i',image_base+text_rva+bind_site+6-text_raw-(trampoline_va+len(trampoline)+5))
    if trampoline_site + len(trampoline) > return_site or any(value != 0x90 for value in data[trampoline_site:trampoline_site+len(trampoline)]):
        raise ValueError('No verified keyboard padding for JS registrations')
    data[trampoline_site:trampoline_site+len(trampoline)] = trampoline
    extension=focus_code+quit_code
    if text_position+len(extension)>text_size or any(data[text_raw+text_position:text_raw+text_position+len(extension)]):
        raise ValueError('No verified executable padding for display commands')
    data[text_raw+text_position:text_raw+text_position+len(extension)]=extension
    struct.pack_into('<I',data,text_header+8,text_position+len(extension))
    data[bind_site:bind_site+6]=b'\xe9'+struct.pack('<i',trampoline_va-(image_base+text_rva+bind_site-text_raw+5))+b'\x90'
    return bytes(data)


def patch_bytes(data):
    data = patch_title_and_shortcuts(data)
    old = b'level="requireAdministrator"'
    if data.count(old) != 1:
        raise ValueError("Expected one requireAdministrator manifest entry")
    data = data.replace(old, b'level="asInvoker"'.ljust(len(old), b" "), 1)
    for chinese in sorted(TEXT, key=len, reverse=True):
        old_text = chinese.encode("utf-16-le")
        new_text = TEXT[chinese].encode("utf-16-le")
        if len(new_text) > len(old_text):
            raise ValueError(f"Native replacement is too long: {chinese}")
        data = data.replace(
            old_text, new_text + b" \0" * ((len(old_text) - len(new_text)) // 2)
        )
    return data


def patch_splash_dialog(template):
    """Change only the verified splash dialog, leaving other native dialogs alone."""
    template = bytearray(template)
    if len(template) != 96 or struct.unpack_from('<HH', template) != (1, 65535):
        raise ValueError('Unexpected splash dialog template')
    if struct.unpack_from('<I', template, 12)[0] != 0x90C008C8:
        raise ValueError('Unexpected splash window style')
    if struct.unpack_from('<I', template, 72)[0] != 0x5000020E:
        raise ValueError('Unexpected splash image style')
    # Frameless, centred popup. Scale its bitmap to fill instead of centring a
    # fixed-pixel image inside a larger dialog (SS_REALSIZECONTROL).
    struct.pack_into('<I', template, 12, 0x90000848)
    struct.pack_into('<I', template, 72, 0x5000004E)
    # MS Shell Dlg 8 has 6x13 dialog base units at standard DPI: this yields a
    # 540x351 client, preserving the source artwork's 400:260 proportions.
    struct.pack_into('<h', template, 24, 216)
    struct.pack_into('<hh', template, 80, 360, 216)
    return bytes(template)


def strip_icons(path, icon_path=None):
    """Remove vendor imagery and install the supplied application icon."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    pointer = ctypes.c_void_p
    name_callback = ctypes.WINFUNCTYPE(
        ctypes.c_int, pointer, pointer, pointer, ctypes.c_ssize_t
    )
    language_callback = ctypes.WINFUNCTYPE(
        ctypes.c_int, pointer, pointer, pointer, ctypes.c_ushort, ctypes.c_ssize_t
    )
    kernel.LoadLibraryExW.argtypes = [ctypes.c_wchar_p, pointer, ctypes.c_uint]
    kernel.LoadLibraryExW.restype = pointer
    kernel.EnumResourceNamesW.argtypes = [
        pointer,
        pointer,
        name_callback,
        ctypes.c_ssize_t,
    ]
    kernel.EnumResourceLanguagesW.argtypes = [
        pointer,
        pointer,
        pointer,
        language_callback,
        ctypes.c_ssize_t,
    ]
    kernel.FreeLibrary.argtypes = [pointer]
    kernel.FindResourceW.argtypes = [pointer, pointer, pointer]
    kernel.FindResourceW.restype = pointer
    kernel.LoadResource.argtypes = [pointer, pointer]
    kernel.LoadResource.restype = pointer
    kernel.LockResource.argtypes = [pointer]
    kernel.LockResource.restype = pointer
    kernel.SizeofResource.argtypes = [pointer, pointer]
    kernel.SizeofResource.restype = ctypes.c_uint
    kernel.BeginUpdateResourceW.argtypes = [ctypes.c_wchar_p, ctypes.c_int]
    kernel.BeginUpdateResourceW.restype = pointer
    kernel.UpdateResourceW.argtypes = [
        pointer,
        pointer,
        pointer,
        ctypes.c_ushort,
        pointer,
        ctypes.c_uint,
    ]
    kernel.EndUpdateResourceW.argtypes = [pointer, ctypes.c_int]

    handle = kernel.LoadLibraryExW(str(path), None, 2)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    resources = []

    @language_callback
    def collect_language(module, kind, name, language, parameter):
        if name > 65535:
            raise ValueError("Unexpected named image resource")
        resources.append((kind, name, language))
        return 1

    @name_callback
    def collect_name(module, kind, name, parameter):
        kernel.EnumResourceLanguagesW(module, kind, name, collect_language, 0)
        return 1

    try:
        resource = kernel.FindResourceW(handle, pointer(131), pointer(5))
        if not resource:
            raise ValueError('Splash dialog resource missing')
        size = kernel.SizeofResource(handle, resource)
        location = kernel.LockResource(kernel.LoadResource(handle, resource))
        splash = patch_splash_dialog(ctypes.string_at(location, size))
        kernel.EnumResourceLanguagesW(handle, pointer(5), pointer(131), collect_language, 0)
        for kind in (2, 3, 14, 16):
            kernel.EnumResourceNamesW(handle, pointer(kind), collect_name, 0)
    finally:
        kernel.FreeLibrary(handle)
    update = kernel.BeginUpdateResourceW(str(path), False)
    if not update:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        metadata = version_resource()
        metadata_buffer = ctypes.create_string_buffer(metadata)
        if not kernel.UpdateResourceW(update, pointer(16), pointer(1), 1033, metadata_buffer, len(metadata)):
            raise ctypes.WinError(ctypes.get_last_error())
        splash_buffer = ctypes.create_string_buffer(splash)
        for kind, name, language in resources:
            if kind == 5 and not kernel.UpdateResourceW(update, pointer(5), pointer(131), language, splash_buffer, len(splash)):
                raise ctypes.WinError(ctypes.get_last_error())
        for kind, name, language in resources:
            if kind == 5 or (kind == 16 and name == 1 and language == 1033):
                continue
            if not kernel.UpdateResourceW(
                update, pointer(kind), pointer(name), language, None, 0
            ):
                raise ctypes.WinError(ctypes.get_last_error())
        if icon_path is not None:
            icon = Path(icon_path).read_bytes()
            reserved, kind, count = struct.unpack_from('<HHH', icon)
            if reserved != 0 or kind != 1 or not count:
                raise ValueError('Invalid application ICO')
            group = bytearray(struct.pack('<HHH', 0, 1, count))
            groups = [(name, language) for kind, name, language in resources if kind == 14]
            if not groups:
                groups = [(128, 1033)]
            languages = set(language for _, language in groups)
            def put(kind, name, language, content):
                buffer = ctypes.create_string_buffer(content)
                if not kernel.UpdateResourceW(update, pointer(kind), pointer(name), language, buffer, len(content)):
                    raise ctypes.WinError(ctypes.get_last_error())
            for index in range(count):
                entry = icon[6 + index * 16:22 + index * 16]
                size, offset = struct.unpack_from('<II', entry, 8)
                payload = icon[offset:offset + size]
                if len(payload) != size:
                    raise ValueError('Truncated ICO image')
                identifier = index + 1
                group.extend(entry[:12] + struct.pack('<H', identifier))
                for language in languages:
                    put(3, identifier, language, payload)
            for name, language in groups:
                put(14, name, language, bytes(group))
    except Exception:
        kernel.EndUpdateResourceW(update, True)
        raise
    if not kernel.EndUpdateResourceW(update, False):
        raise ctypes.WinError(ctypes.get_last_error())


def prepare_native(source, output):
    executable = next(source.glob("*.exe"))
    app_name = json.loads((Path(__file__).resolve().parents[1] / 'src/app.json').read_text(encoding='utf-8'))['name']
    if any(character in app_name for character in '<>:"/\\|?*'):
        raise ValueError('Application name is not a valid Windows filename')
    target = output / "native-update" / (app_name + '.exe')
    target.parent.mkdir(parents=True, exist_ok=True)
    original = executable.read_bytes()
    patched = patch_bytes(original)
    marker = "\u4f53\u80b2\u7ade\u8d5b\u7c7b\u8f6f\u4ef6\u4f7f\u7528\u8bb8\u53ef\u534f\u8bae".encode("gbk")
    location = original.find(marker)
    if location >= 0:
        begin = original.rfind(b"\0", 0, location) + 1
        end = original.index(b"\0", location)
        notice = original[begin:end]
        summary = app_name.encode('ascii')
        if len(summary) > len(notice):
            raise ValueError("Unexpected short licence display resource")
        patched = patched[:begin] + summary.ljust(len(notice), b" ") + patched[end:]
    old_notice = output / 'notices/Vendor-Licence.txt'
    if old_notice.exists():
        if not old_notice.resolve().is_relative_to(output.resolve()):
            raise ValueError('Notice path escaped the generated package')
        old_notice.unlink()
        if not any(old_notice.parent.iterdir()):
            old_notice.parent.rmdir()
    target.write_bytes(patched)
    strip_icons(target.resolve(), Path(__file__).resolve().parents[1] / 'src/assets/app.ico')
    previous_names = json.loads((Path(__file__).resolve().parents[1] / 'src/app.json').read_text(encoding='utf-8')).get('previousNames', [])
    for name in [executable.name] + [name + '.exe' for name in previous_names]:
        legacy = target.parent / name
        if legacy != target and legacy.exists():
            legacy.unlink()
    return target
