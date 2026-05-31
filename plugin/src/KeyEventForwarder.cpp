// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
#include "KeyEventForwarder.h"
#include <unordered_map>

// プラットフォーム固有ヘッダは実装側のみに限定してインクルードし、
// JUCE のシンボル（Component/Point 等）との競合を避ける
#if JUCE_WINDOWS
 #include <windows.h>
#endif

#if JUCE_MAC
 #include <ApplicationServices/ApplicationServices.h>
 #include <unistd.h> // getpid
#endif

#if JUCE_LINUX || JUCE_BSD
 // X11 ヘッダは JUCE のシンボルと競合しやすいマクロ(None/Bool/KeyPress 等)を定義するため、
 //  実装側でのみ・JUCE ヘッダの後にインクルードする。
 #include <X11/Xlib.h>
 #include <X11/keysym.h>
 #include <cstring>
 #include <unordered_map>
#endif

namespace zc
{

#if JUCE_LINUX || JUCE_BSD
// ---- Linux(X11) 実装 ----------------------------------------------------------
//  Windows の PostMessage 相当。ホストのトップレベルウィンドウへ XSendEvent でキーイベントを
//  合成送出し、DAW のキーボードショートカットへ届ける。WebView(別プロセスの WebKitGTK)が
//  キーを奪うため、JS→native→XSendEvent でホストに橋渡しする。
namespace
{
    // 送出用の X11 接続（ウィンドウ ID は X サーバ全体で有効なので別接続でも送れる）。1 回だけ開く。
    Display* getForwardingDisplay()
    {
        static Display* display = XOpenDisplay (nullptr);
        return display;
    }

    // プラグインの埋め込みウィンドウから親を辿り、root 直下のトップレベル（= DAW の窓）を返す。
    ::Window resolveHostTopLevel (Display* display, ::Window start)
    {
        const ::Window root = DefaultRootWindow (display);
        ::Window current = start;
        for (int guard = 0; guard < 24 && current != 0; ++guard)
        {
            ::Window r = 0, parent = 0, *children = nullptr;
            unsigned int numChildren = 0;
            if (! XQueryTree (display, current, &r, &parent, &children, &numChildren))
                break;
            if (children != nullptr)
                XFree (children);
            if (parent == 0 || parent == root)
                break; // current が root 直下のトップレベル
            current = parent;
        }
        return current;
    }

    // DOM の code（物理キー）/ key（文字）から X11 KeySym へ変換（Windows の domCodeToVirtualKey 相当）。
    KeySym domToKeysym (const juce::String& code, const juce::String& key)
    {
        static const std::unordered_map<juce::String, KeySym> table = []
        {
            std::unordered_map<juce::String, KeySym> m;
            m.emplace ("Space", XK_space);
            m.emplace ("Enter", XK_Return);
            m.emplace ("NumpadEnter", XK_KP_Enter);
            m.emplace ("Tab", XK_Tab);
            m.emplace ("Backspace", XK_BackSpace);
            m.emplace ("Delete", XK_Delete);
            m.emplace ("Escape", XK_Escape);
            m.emplace ("ArrowUp", XK_Up);
            m.emplace ("ArrowDown", XK_Down);
            m.emplace ("ArrowLeft", XK_Left);
            m.emplace ("ArrowRight", XK_Right);
            m.emplace ("Home", XK_Home);
            m.emplace ("End", XK_End);
            m.emplace ("PageUp", XK_Prior);
            m.emplace ("PageDown", XK_Next);
            m.emplace ("Insert", XK_Insert);
            m.emplace ("CapsLock", XK_Caps_Lock);
            m.emplace ("ShiftLeft", XK_Shift_L);
            m.emplace ("ShiftRight", XK_Shift_R);
            m.emplace ("ControlLeft", XK_Control_L);
            m.emplace ("ControlRight", XK_Control_R);
            m.emplace ("AltLeft", XK_Alt_L);
            m.emplace ("AltRight", XK_Alt_R);
            m.emplace ("MetaLeft", XK_Super_L);
            m.emplace ("MetaRight", XK_Super_R);
            m.emplace ("ContextMenu", XK_Menu);
            m.emplace ("NumLock", XK_Num_Lock);
            m.emplace ("ScrollLock", XK_Scroll_Lock);
            m.emplace ("Pause", XK_Pause);
            m.emplace ("PrintScreen", XK_Print);
            m.emplace ("Minus", XK_minus);
            m.emplace ("Equal", XK_equal);
            m.emplace ("BracketLeft", XK_bracketleft);
            m.emplace ("BracketRight", XK_bracketright);
            m.emplace ("Backslash", XK_backslash);
            m.emplace ("IntlBackslash", XK_less);
            m.emplace ("Semicolon", XK_semicolon);
            m.emplace ("Quote", XK_apostrophe);
            m.emplace ("Comma", XK_comma);
            m.emplace ("Period", XK_period);
            m.emplace ("Slash", XK_slash);
            m.emplace ("Backquote", XK_grave);
            m.emplace ("NumpadDecimal", XK_KP_Decimal);
            m.emplace ("NumpadDivide", XK_KP_Divide);
            m.emplace ("NumpadMultiply", XK_KP_Multiply);
            m.emplace ("NumpadSubtract", XK_KP_Subtract);
            m.emplace ("NumpadAdd", XK_KP_Add);
            m.emplace ("NumpadEqual", XK_KP_Equal);
            m.emplace ("NumpadComma", XK_KP_Separator);
            return m;
        }();

        if (const auto it = table.find (code); it != table.end())
            return it->second;

        // KeyA-KeyZ → XK_a..XK_z（小文字。Shift は state 側で表現）
        if (code.startsWith ("Key") && code.length() == 4)
        {
            const auto letter = juce::CharacterFunctions::toLowerCase (code[3]);
            if (letter >= 'a' && letter <= 'z')
                return static_cast<KeySym> (XK_a + (letter - 'a'));
        }
        // Digit0-Digit9
        if (code.startsWith ("Digit") && code.length() == 6)
        {
            const auto d = code[5];
            if (d >= '0' && d <= '9')
                return static_cast<KeySym> (XK_0 + (d - '0'));
        }
        // Numpad0-Numpad9
        if (code.startsWith ("Numpad") && code.length() == 7)
        {
            const auto d = code[6];
            if (d >= '0' && d <= '9')
                return static_cast<KeySym> (XK_KP_0 + (d - '0'));
        }
        // F1-F24
        if (code.startsWith ("F") && code.length() >= 2)
        {
            const int fn = code.substring (1).getIntValue();
            if (fn >= 1 && fn <= 24)
                return static_cast<KeySym> (XK_F1 + fn - 1);
        }
        // フォールバック: 1 文字の key は XStringToKeysym で解決（記号等）
        if (key.length() == 1)
        {
            const auto ks = XStringToKeysym (key.toRawUTF8());
            if (ks != NoSymbol)
                return ks;
        }
        return NoSymbol;
    }

    bool dispatchKeyEventUsingX11 (const juce::var& eventData, juce::Component* editorComponent, bool isKeyDown)
    {
        Display* display = getForwardingDisplay();
        if (display == nullptr || editorComponent == nullptr)
            return false;

        auto* peer = editorComponent->getPeer();
        if (peer == nullptr)
            return false;

        const ::Window pluginWindow = (::Window) peer->getNativeHandle();
        if (pluginWindow == 0)
            return false;

        const juce::String code = eventData.getProperty ("code", juce::var{}).toString();
        const juce::String key  = eventData.getProperty ("key",  juce::var{}).toString();
        const KeySym keysym = domToKeysym (code, key);
        if (keysym == NoSymbol)
            return false;

        const KeyCode keycode = XKeysymToKeycode (display, keysym);
        if (keycode == 0)
            return false;

        unsigned int state = 0;
        if (static_cast<bool> (eventData.getProperty ("shiftKey", false))) state |= ShiftMask;
        if (static_cast<bool> (eventData.getProperty ("ctrlKey",  false))) state |= ControlMask;
        if (static_cast<bool> (eventData.getProperty ("altKey",   false))) state |= Mod1Mask;
        if (static_cast<bool> (eventData.getProperty ("metaKey",  false))) state |= Mod4Mask;

        const ::Window target = resolveHostTopLevel (display, pluginWindow);
        if (target == 0)
            return false;

        XKeyEvent ev;
        std::memset (&ev, 0, sizeof (ev));
        ev.display     = display;
        ev.window      = target;
        ev.root        = DefaultRootWindow (display);
        ev.subwindow   = None;
        ev.time        = CurrentTime;
        ev.same_screen = True;
        ev.x = ev.y = 1;
        ev.x_root = ev.y_root = 1;
        ev.state    = state;
        ev.keycode  = keycode;
        ev.type     = isKeyDown ? KeyPress : KeyRelease;

        XSendEvent (display, target, True, isKeyDown ? KeyPressMask : KeyReleaseMask,
                    reinterpret_cast<XEvent*> (&ev));
        XFlush (display);
        return true;
    }
} // anonymous namespace
#endif // JUCE_LINUX || JUCE_BSD


bool KeyEventForwarder::forwardKeyEventToHost(const juce::var& eventData, juce::Component* editorComponent)
{
    if (!eventData.isObject())
    {
        return false;
    }

    const auto type = eventData.getProperty("type", juce::var{}).toString();
    const bool isKeyDown = type.equalsIgnoreCase("keydown");
    const bool isKeyUp = type.equalsIgnoreCase("keyup");

    if (!isKeyDown && !isKeyUp)
    {
        return false;
    }

#if JUCE_WINDOWS
    const auto code = eventData.getProperty("code", juce::var{}).toString();
    const bool repeat = static_cast<bool>(eventData.getProperty("repeat", false));
    // domKeyCode は Windows で仮想キーコードのフォールバックとして使用
    const int domKeyCode = juce::roundToInt((double) eventData.getProperty("keyCode", 0));

    // repeat は Windows の lParam (bit30: 前回押下状態) 設定に利用する

    WORD vk = domKeyCode > 0 ? static_cast<WORD>(domKeyCode) : 0;

    if ((vk == 0) && code.isNotEmpty())
        vk = domCodeToVirtualKey(code);

    // 修飾キーの左右判定
    if (vk == VK_SHIFT)
    {
        if (code == "ShiftLeft")
            vk = VK_LSHIFT;
        else if (code == "ShiftRight")
            vk = VK_RSHIFT;
    }
    else if (vk == VK_CONTROL)
    {
        if (code == "ControlLeft")
            vk = VK_LCONTROL;
        else if (code == "ControlRight")
            vk = VK_RCONTROL;
    }
    else if (vk == VK_MENU)
    {
        if (code == "AltLeft")
            vk = VK_LMENU;
        else if (code == "AltRight")
            vk = VK_RMENU;
    }
    else if (code == "MetaLeft")
    {
        vk = VK_LWIN;
    }
    else if (code == "MetaRight")
    {
        vk = VK_RWIN;
    }

    if (vk == 0)
    {
        return false;
    }

    auto* peer = editorComponent->getPeer();
    if (peer == nullptr)
    {
        return false;
    }

    const auto nativeHandle = reinterpret_cast<HWND>(peer->getNativeHandle());
    if (nativeHandle == nullptr)
    {
        return false;
    }

    // 親ホストのトップレベルでフォーカス可能なウィンドウを解決
    HWND hostWindow = resolveHostWindowForForwarding(nativeHandle);
    if (hostWindow == nullptr)
        hostWindow = nativeHandle;
    
    // すべてのDAWで統一処理: PostMessage/SendMessage方式
    const LPARAM scan = static_cast<LPARAM>(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)) << 16;
    // lParam フラグ生成
    // - bit24: 拡張キー
    // - bit30: 直前のキー状態 (1=押下済み) → リピートkeydown時は1にする
    // - bit31: トランジション状態 (1=キーアップ)
    DWORD lparamFlags = (isExtendedVirtualKey(vk, code) ? (1u << 24) : 0u)
                      | (isKeyUp ? (1u << 31) : 0u)
                      | 1u; // repeat count = 1
    if (!isKeyUp && repeat)
        lparamFlags |= (1u << 30);
    if (isKeyUp)
        lparamFlags |= (1u << 30); // keyup では直前に押下されていたことを示す
    const LPARAM lparam = scan | static_cast<LPARAM>(lparamFlags);

    const UINT msg = (vk == VK_MENU || vk == VK_F10) ? (isKeyDown ? WM_SYSKEYDOWN : WM_SYSKEYUP)
                                                     : (isKeyDown ? WM_KEYDOWN : WM_KEYUP);
    
    // Method 1: Try PostMessage to main window first
    if (PostMessageW(hostWindow, msg, static_cast<WPARAM>(vk), lparam)) {
        return true;
    }
    
    // Method 2: Try SendMessage as fallback
    SendMessageW(hostWindow, msg, static_cast<WPARAM>(vk), lparam);
    return true;

#elif JUCE_MAC
    return dispatchKeyEventUsingCocoa(eventData, editorComponent);
#elif JUCE_LINUX || JUCE_BSD
    // X11: ホストのトップレベルウィンドウへキーイベントを合成送出する（Windows の PostMessage 相当）。
    return dispatchKeyEventUsingX11 (eventData, editorComponent, isKeyDown);
#else
    return false;
#endif
}

#if JUCE_WINDOWS


bool KeyEventForwarder::handleDefaultPostMessage(HWND nativeHandle, HWND hostWindow, WORD vk, bool isKeyDown, bool isKeyUp, bool repeat, const juce::String& code)
{
    juce::ignoreUnused(nativeHandle);  // 現在の実装では使用しない
    
    // デフォルト処理: PostMessage/SendMessage方式
    // Reaper, Ableton Live, DaVinci Resolve, WaveLab などで動作確認済み
    
    const LPARAM scan = static_cast<LPARAM>(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)) << 16;
    // lParam フラグ生成
    // - bit24: 拡張キー
    // - bit30: 直前のキー状態 (1=押下済み) → リピートkeydown時は1にする
    // - bit31: トランジション状態 (1=キーアップ)
    DWORD lparamFlags = (isExtendedVirtualKey(vk, code) ? (1u << 24) : 0u)
                      | (isKeyUp ? (1u << 31) : 0u)
                      | 1u; // repeat count = 1
    if (!isKeyUp && repeat)
        lparamFlags |= (1u << 30);
    if (isKeyUp)
        lparamFlags |= (1u << 30); // keyup では直前に押下されていたことを示す
    const LPARAM lparam = scan | static_cast<LPARAM>(lparamFlags);

    const UINT msg = (vk == VK_MENU || vk == VK_F10) ? (isKeyDown ? WM_SYSKEYDOWN : WM_SYSKEYUP)
                                                     : (isKeyDown ? WM_KEYDOWN : WM_KEYUP);
    
    // Method 1: Try PostMessage to main window first
    if (PostMessageW(hostWindow, msg, static_cast<WPARAM>(vk), lparam)) {
        return true;
    }
    
    // Method 2: Try SendMessage as fallback
    SendMessageW(hostWindow, msg, static_cast<WPARAM>(vk), lparam);
    return true;
}



// Windows用ヘルパー関数の実装

// トップレベルのフォーカス可能ウィンドウかどうかを判定
static bool isTopLevelFocusableWindow(HWND hwnd)
{
    if (hwnd == nullptr)
        return false;

    if (!IsWindow(hwnd) || !IsWindowVisible(hwnd))
        return false;

    const LONG_PTR style = GetWindowLongPtr(hwnd, GWL_STYLE);
    return (style & WS_CHILD) == 0;
}

juce::String KeyEventForwarder::hwndToInfo(HWND hwnd)
{
    if (hwnd == nullptr)
        return "<null>";

    wchar_t title[256]{};
    wchar_t cls[256]{};
    GetWindowTextW(hwnd, title, 255);
    GetClassNameW(hwnd, cls, 255);
    DWORD pid = 0;
    const DWORD tid = GetWindowThreadProcessId(hwnd, &pid);

    juce::String s;
    s << "HWND=" << juce::String::toHexString((juce::int64)(intptr_t)hwnd)
      << " tid=" << (int)tid
      << " pid=" << (int)pid
      << " title=\"" << juce::String(title) << "\""
      << " class=\"" << juce::String(cls) << "\"";
    return s;
}

HWND KeyEventForwarder::resolveHostWindowForForwarding(HWND pluginWindow)
{
    if (pluginWindow == nullptr)
        return nullptr;

    HWND candidate = pluginWindow;
    
    // DAW特有のメインウィンドウを検出
    DWORD pluginPid{};
    GetWindowThreadProcessId(pluginWindow, &pluginPid);
    
    struct DAWWindowInfo
    {
        DWORD pid;
        HWND genericMain{};     // その他のDAW用汎用候補
    } dawInfo{ pluginPid };
    
    // 特定DAWのメインウィンドウを探す（クラス名による特定は最小限に）
    EnumWindows(
        [](HWND hwnd, LPARAM lParam) -> BOOL
        {
            auto* info = reinterpret_cast<DAWWindowInfo*>(lParam);
            
            DWORD pid{};
            GetWindowThreadProcessId(hwnd, &pid);
            if (pid != info->pid || !IsWindowVisible(hwnd))
                return TRUE;
                
            // トップレベルウィンドウを収集
            if (GetParent(hwnd) == nullptr && isTopLevelFocusableWindow(hwnd))
            {
                // メニューを持つウィンドウを優先
                if (GetMenu(hwnd) != nullptr && info->genericMain == nullptr)
                {
                    info->genericMain = hwnd;
                }
            }
            
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&dawInfo));
    
    if (dawInfo.genericMain != nullptr)
        candidate = dawInfo.genericMain;
    
    // 従来のロジック（親階層を辿る）
    if (candidate == pluginWindow)
    {
        HWND current = pluginWindow;
        while (HWND parent = GetParent(current))
        {
            current = parent;
            if (isTopLevelFocusableWindow(current))
            {
                candidate = current;
                break;
            }
        }
    }

    return candidate;
}

WORD KeyEventForwarder::domCodeToVirtualKey(const juce::String& code)
{
    static const std::unordered_map<juce::String, WORD> table = [] {
        std::unordered_map<juce::String, WORD> map;
        map.reserve(96);
        map.emplace("Space", VK_SPACE);
        map.emplace("Enter", VK_RETURN);
        map.emplace("NumpadEnter", VK_RETURN);
        map.emplace("Tab", VK_TAB);
        map.emplace("Backspace", VK_BACK);
        map.emplace("Delete", VK_DELETE);
        map.emplace("Escape", VK_ESCAPE);
        map.emplace("ArrowUp", VK_UP);
        map.emplace("ArrowDown", VK_DOWN);
        map.emplace("ArrowLeft", VK_LEFT);
        map.emplace("ArrowRight", VK_RIGHT);
        map.emplace("Home", VK_HOME);
        map.emplace("End", VK_END);
        map.emplace("PageUp", VK_PRIOR);
        map.emplace("PageDown", VK_NEXT);
        map.emplace("Insert", VK_INSERT);
        map.emplace("CapsLock", VK_CAPITAL);
        map.emplace("ShiftLeft", VK_LSHIFT);
        map.emplace("ShiftRight", VK_RSHIFT);
        map.emplace("ControlLeft", VK_LCONTROL);
        map.emplace("ControlRight", VK_RCONTROL);
        map.emplace("AltLeft", VK_LMENU);
        map.emplace("AltRight", VK_RMENU);
        map.emplace("MetaLeft", VK_LWIN);
        map.emplace("MetaRight", VK_RWIN);
        map.emplace("ContextMenu", VK_APPS);
        map.emplace("NumLock", VK_NUMLOCK);
        map.emplace("ScrollLock", VK_SCROLL);
        map.emplace("Pause", VK_PAUSE);
        map.emplace("PrintScreen", VK_SNAPSHOT);
        map.emplace("Minus", VK_OEM_MINUS);
        map.emplace("Equal", VK_OEM_PLUS);
        map.emplace("BracketLeft", VK_OEM_4);
        map.emplace("BracketRight", VK_OEM_6);
        map.emplace("Backslash", VK_OEM_5);
        map.emplace("IntlBackslash", VK_OEM_102);
        map.emplace("Semicolon", VK_OEM_1);
        map.emplace("Quote", VK_OEM_7);
        map.emplace("Comma", VK_OEM_COMMA);
        map.emplace("Period", VK_OEM_PERIOD);
        map.emplace("Slash", VK_OEM_2);
        map.emplace("Backquote", VK_OEM_3);
        // Numpadキー
        map.emplace("NumpadDecimal", VK_DECIMAL);
        map.emplace("NumpadDivide", VK_DIVIDE);
        map.emplace("NumpadMultiply", VK_MULTIPLY);
        map.emplace("NumpadSubtract", VK_SUBTRACT);
        map.emplace("NumpadAdd", VK_ADD);
        map.emplace("NumpadEqual", VK_OEM_PLUS);
        map.emplace("NumpadComma", VK_DECIMAL);
        map.emplace("NumpadClear", VK_CLEAR);
        return map;
    }();

    if (const auto it = table.find(code); it != table.end())
        return it->second;

    // KeyA-KeyZ
    if (code.startsWith("Key") && code.length() == 4)
    {
        const auto letter = code[3];
        if (juce::CharacterFunctions::isLetter(letter))
            return static_cast<WORD>(juce::CharacterFunctions::toUpperCase(letter));
    }

    // Digit0-Digit9
    if (code.startsWith("Digit") && code.length() == 6)
    {
        const auto digit = code[5];
        if (juce::CharacterFunctions::isDigit(digit))
            return static_cast<WORD>(digit);
    }

    // Numpad0-Numpad9
    if (code.startsWith("Numpad") && code.length() == 7)
    {
        const auto digit = code[6];
        if (juce::CharacterFunctions::isDigit(digit))
            return static_cast<WORD>(VK_NUMPAD0 + (digit - '0'));
    }

    // F1-F24
    if (code.startsWith("F"))
    {
        const auto functionNumber = code.substring(1).getIntValue();
        if (functionNumber >= 1 && functionNumber <= 24)
            return static_cast<WORD>(VK_F1 + functionNumber - 1);
    }

    return 0;
}

bool KeyEventForwarder::isExtendedVirtualKey(const WORD vk, const juce::String& code)
{
    switch (vk)
    {
        case VK_RCONTROL:
        case VK_RMENU:
        case VK_PRIOR:
        case VK_NEXT:
        case VK_HOME:
        case VK_END:
        case VK_INSERT:
        case VK_DELETE:
        case VK_LEFT:
        case VK_RIGHT:
        case VK_UP:
        case VK_DOWN:
        case VK_DIVIDE:
        case VK_NUMLOCK:
            return true;
        default:
            break;
    }

    if (code == "NumpadEnter")
        return true;

    return false;
}

#endif // JUCE_WINDOWS


#if JUCE_MAC

std::optional<unsigned short> KeyEventForwarder::domCodeToMacKey(const juce::String& code)
{
    // macOS のハードウェアキーコードテーブル
    // 参考: https://developer.apple.com/library/archive/technotes/tn2450/_index.html
    // 注意: 配列/記号キーはキーボードレイアウトに依存。DAW操作で頻出のコードを優先して定義。
    static const std::unordered_map<juce::String, unsigned short> table = [] {
        std::unordered_map<juce::String, unsigned short> map;
        // 制御・編集
        map.emplace("Escape", 53);
        map.emplace("Backspace", 51);      // Delete (backspace)
        map.emplace("Tab", 48);
        map.emplace("Enter", 36);          // Return
        map.emplace("NumpadEnter", 76);    // Enter (keypad)
        map.emplace("Space", 49);
        map.emplace("Delete", 117);        // Forward delete
        // 矢印・ナビゲーション
        map.emplace("ArrowLeft", 123);
        map.emplace("ArrowRight", 124);
        map.emplace("ArrowDown", 125);
        map.emplace("ArrowUp", 126);
        map.emplace("Home", 115);
        map.emplace("End", 119);
        map.emplace("PageUp", 116);
        map.emplace("PageDown", 121);
        // ファンクションキー
        for (int i = 1; i <= 12; ++i)
        {
            // macOS の F1 は 122, F2=120, F3=99, F4=118, F5=96, F6=97, F7=98, F8=100, F9=101, F10=109, F11=103, F12=111
            // ばらつくため個別に対応
        }
        map.emplace("F1", 122);
        map.emplace("F2", 120);
        map.emplace("F3", 99);
        map.emplace("F4", 118);
        map.emplace("F5", 96);
        map.emplace("F6", 97);
        map.emplace("F7", 98);
        map.emplace("F8", 100);
        map.emplace("F9", 101);
        map.emplace("F10", 109);
        map.emplace("F11", 103);
        map.emplace("F12", 111);
        // 記号キー（US配列準拠、他配列では異なる可能性がある）
        map.emplace("Minus", 27);
        map.emplace("Equal", 24);
        map.emplace("BracketLeft", 33);
        map.emplace("BracketRight", 30);
        map.emplace("Backslash", 42);
        map.emplace("Semicolon", 41);
        map.emplace("Quote", 39);
        map.emplace("Comma", 43);
        map.emplace("Period", 47);
        map.emplace("Slash", 44);
        map.emplace("Backquote", 50);
        // テンキー
        map.emplace("Numpad0", 82);
        map.emplace("Numpad1", 83);
        map.emplace("Numpad2", 84);
        map.emplace("Numpad3", 85);
        map.emplace("Numpad4", 86);
        map.emplace("Numpad5", 87);
        map.emplace("Numpad6", 88);
        map.emplace("Numpad7", 89);
        map.emplace("Numpad8", 91);
        map.emplace("Numpad9", 92);
        map.emplace("NumpadDecimal", 65);
        map.emplace("NumpadDivide", 75);
        map.emplace("NumpadMultiply", 67);
        map.emplace("NumpadSubtract", 78);
        map.emplace("NumpadAdd", 69);
        // 修飾の左右判定（CGEvent のフラグで表現するのでキーコードは参考値）
        map.emplace("ShiftLeft", 56);
        map.emplace("ShiftRight", 60);
        map.emplace("ControlLeft", 59);
        map.emplace("ControlRight", 62);
        map.emplace("AltLeft", 58);
        map.emplace("AltRight", 61);
        map.emplace("MetaLeft", 55);   // Command (left)
        map.emplace("MetaRight", 54);  // Command (right)
        // アルファベット
        map.emplace("KeyA", 0);
        map.emplace("KeyS", 1);
        map.emplace("KeyD", 2);
        map.emplace("KeyF", 3);
        map.emplace("KeyH", 4);
        map.emplace("KeyG", 5);
        map.emplace("KeyZ", 6);
        map.emplace("KeyX", 7);
        map.emplace("KeyC", 8);
        map.emplace("KeyV", 9);
        map.emplace("KeyB", 11);
        map.emplace("KeyQ", 12);
        map.emplace("KeyW", 13);
        map.emplace("KeyE", 14);
        map.emplace("KeyR", 15);
        map.emplace("KeyY", 16);
        map.emplace("KeyT", 17);
        map.emplace("Key1", 18);  // Digit1 (US)
        map.emplace("Key2", 19);
        map.emplace("Key3", 20);
        map.emplace("Key4", 21);
        map.emplace("Key6", 22);
        map.emplace("Key5", 23);
        map.emplace("KeyEqualUS", 24); // Equal (US)
        map.emplace("Key9", 25);
        map.emplace("Key7", 26);
        map.emplace("KeyMinusUS", 27); // Minus (US)
        map.emplace("Key8", 28);
        map.emplace("Key0", 29);
        map.emplace("KeyRightBracketUS", 30);
        map.emplace("KeyO", 31);
        map.emplace("KeyU", 32);
        map.emplace("KeyLeftBracketUS", 33);
        map.emplace("KeyI", 34);
        map.emplace("KeyP", 35);
        map.emplace("KeyReturnUS", 36);
        map.emplace("KeyL", 37);
        map.emplace("KeyJ", 38);
        map.emplace("KeyQuoteUS", 39);
        map.emplace("KeyK", 40);
        map.emplace("KeySemicolonUS", 41);
        map.emplace("KeyBackslashUS", 42);
        map.emplace("KeyCommaUS", 43);
        map.emplace("KeySlashUS", 44);
        map.emplace("KeyN", 45);
        map.emplace("KeyM", 46);
        map.emplace("KeyPeriodUS", 47);
        map.emplace("KeyTabUS", 48);
        map.emplace("KeySpaceUS", 49);
        map.emplace("KeyBackquoteUS", 50);
        map.emplace("KeyDeleteUS", 51);
        map.emplace("KeyEnterUS", 52);
        map.emplace("KeyEscapeUS", 53);
        return map;
    }();
    
    if (const auto it = table.find(code); it != table.end())
        return it->second;
    
    return std::nullopt;
}

#if JUCE_MAC
std::optional<unsigned short> KeyEventForwarder::lookupMacKeyCodeFromUnicodeChar(juce::juce_wchar unicodeChar)
{
    // macOS 15 SDK では TIS/LMGetKbdType シンボルのリンクが不安定なため、
    // レイアウト依存のキーコード探索は行わず Unicode 送出にフォールバックする。
    juce::ignoreUnused(unicodeChar);
    return std::nullopt;
}
#endif

#endif // JUCE_MAC

} // namespace zc
