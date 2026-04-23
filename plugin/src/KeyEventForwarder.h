#pragma once

#ifndef DONT_SET_USING_JUCE_NAMESPACE
#define DONT_SET_USING_JUCE_NAMESPACE 1
#define MC3_UNDEF_DONT_SET_USING_JUCE_NAMESPACE 1
#endif
#include <JuceHeader.h>
#ifdef MC3_UNDEF_DONT_SET_USING_JUCE_NAMESPACE
#undef MC3_UNDEF_DONT_SET_USING_JUCE_NAMESPACE
#undef DONT_SET_USING_JUCE_NAMESPACE
#endif
#include <optional>

// 注意:
// - プラットフォーム固有ヘッダ（<windows.h> / Carbon 等）は本ヘッダではインクルードしない。
//   これらはグローバル名前空間へシンボルを定義し、JUCE のシンボルと競合（Component/Point 等）しやすいため。
// - 代わりに実装ファイル(KeyEventForwarder.cpp)側でのみインクルードする。

// Windows 固有の型の前方宣言（<windows.h> をインクルードせずに使用できるようにする）
#if JUCE_WINDOWS
    // Windows.h の型を前方宣言（実装は .cpp 側でインクルードされる <windows.h> を使用）
    typedef unsigned short WORD;
    struct HWND__;
    typedef struct HWND__* HWND;
#endif

namespace zc
{
    /**
     * キーイベントをDAWホストへ転送するためのユーティリティクラス
     */
    class KeyEventForwarder
    {
    public:
        /**
         * JavaScriptから受け取ったキーイベントをホストDAWへ転送
         * @param eventData JavaScript から受け取ったイベントデータ
         * @param editorComponent エディターコンポーネントへの参照
         * @return 転送に成功した場合true
         */
        static bool forwardKeyEventToHost(const juce::var& eventData, juce::Component* editorComponent);

    private:
#if JUCE_WINDOWS
        // Windows用のヘルパー関数
        static WORD domCodeToVirtualKey(const juce::String& code);
        static bool isExtendedVirtualKey(WORD vk, const juce::String& code);
        static HWND resolveHostWindowForForwarding(HWND pluginWindow);
        static juce::String hwndToInfo(HWND hwnd);
        
        // デフォルト処理（すべてのDAWで使用）
        static bool handleDefaultPostMessage(HWND nativeHandle, HWND hostWindow, WORD vk, bool isKeyDown, bool isKeyUp, bool repeat, const juce::String& code);
#endif

#if JUCE_MAC
        // macOS用のヘルパー関数
        static std::optional<unsigned short> domCodeToMacKey(const juce::String& code);
        static bool dispatchKeyEventUsingCocoa(const juce::var& eventData, juce::Component* editorComponent);
        /**
         * 現在のキーボードレイアウトから、指定Unicode文字を生成できるkeyCodeを探索
         * 成功した場合、そのハードウェアkeyCodeを返す（修飾子は含まない）
         * 注意: レイアウトやデッドキーに依存するため、厳密一致は保証しない
         */
        static std::optional<unsigned short> lookupMacKeyCodeFromUnicodeChar(juce::juce_wchar unicodeChar);
#endif
    };
}
