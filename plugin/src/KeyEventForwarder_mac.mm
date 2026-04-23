#include "KeyEventForwarder.h"

#if JUCE_MAC
 #import <Cocoa/Cocoa.h>
 #include <unordered_map>
 #include <objc/runtime.h>
 #include <objc/message.h>
 #include <juce_core/native/juce_ObjCHelpers_mac.h>

namespace zc
{
namespace
{
    static bool isMessageThread()
    {
        if (auto* mm = juce::MessageManager::getInstanceWithoutCreating())
            return mm->isThisTheMessageThread();

        return true;
    }

    static NSEventModifierFlags makeModifierFlags(const juce::var& eventData, const juce::String& code)
    {
        NSEventModifierFlags flags = 0;

        if (static_cast<bool>(eventData.getProperty("shiftKey", false)))
            flags |= NSEventModifierFlagShift;
        if (static_cast<bool>(eventData.getProperty("altKey", false)))
            flags |= NSEventModifierFlagOption;
        if (static_cast<bool>(eventData.getProperty("ctrlKey", false)))
            flags |= NSEventModifierFlagControl;
        if (static_cast<bool>(eventData.getProperty("metaKey", false)))
            flags |= NSEventModifierFlagCommand;

        if (code.startsWith("Numpad"))
            flags |= NSEventModifierFlagNumericPad;

        return flags;
    }

    static std::optional<juce::juce_wchar> characterForDomKey(const juce::String& key)
    {
        if (key.isEmpty())
            return std::nullopt;

        if (key.length() == 1)
            return static_cast<juce::juce_wchar>(key[0]);

        if (key == "Enter" || key == "Return")
            return static_cast<juce::juce_wchar>(NSCarriageReturnCharacter);
        if (key == "NumpadEnter")
            return static_cast<juce::juce_wchar>(NSEnterCharacter);
        if (key == "Tab")
            return static_cast<juce::juce_wchar>(NSTabCharacter);
        if (key == "Backspace")
            return static_cast<juce::juce_wchar>(NSBackspaceCharacter);
        if (key == "Delete")
            return static_cast<juce::juce_wchar>(NSDeleteCharacter);
        if (key == "Escape")
            return static_cast<juce::juce_wchar>(0x001B);
        if (key == "Space")
            return static_cast<juce::juce_wchar>(' ');
        if (key == "ArrowUp")
            return static_cast<juce::juce_wchar>(NSUpArrowFunctionKey);
        if (key == "ArrowDown")
            return static_cast<juce::juce_wchar>(NSDownArrowFunctionKey);
        if (key == "ArrowLeft")
            return static_cast<juce::juce_wchar>(NSLeftArrowFunctionKey);
        if (key == "ArrowRight")
            return static_cast<juce::juce_wchar>(NSRightArrowFunctionKey);
        if (key == "Home")
            return static_cast<juce::juce_wchar>(NSHomeFunctionKey);
        if (key == "End")
            return static_cast<juce::juce_wchar>(NSEndFunctionKey);
        if (key == "PageUp")
            return static_cast<juce::juce_wchar>(NSPageUpFunctionKey);
        if (key == "PageDown")
            return static_cast<juce::juce_wchar>(NSPageDownFunctionKey);
        if (key == "Insert")
            return static_cast<juce::juce_wchar>(NSInsertFunctionKey);

        if (key.startsWith("F"))
        {
            const auto functionNumber = key.substring(1).getIntValue();
            if (functionNumber >= 1 && functionNumber <= 35)
                return static_cast<juce::juce_wchar>(NSF1FunctionKey + functionNumber - 1);
        }

        return std::nullopt;
    }

    static std::optional<juce::juce_wchar> baseCharacterForDomCode(const juce::String& code)
    {
        if (code.startsWith("Key") && code.length() == 4)
            return static_cast<juce::juce_wchar>(juce::CharacterFunctions::toLowerCase(code[3]));

        if (code.startsWith("Digit") && code.length() == 6)
        {
            const auto digit = code[5];
            if (juce::CharacterFunctions::isDigit(digit))
                return static_cast<juce::juce_wchar>(digit);
        }

        static const std::unordered_map<juce::String, juce::juce_wchar> table {
            { "Minus", '-' },
            { "Equal", '=' },
            { "BracketLeft", '[' },
            { "BracketRight", ']' },
            { "Backslash", '\\' },
            { "Semicolon", ';' },
            { "Quote", '\'' },
            { "Comma", ',' },
            { "Period", '.' },
            { "Slash", '/' },
            { "Backquote", '`' },
            { "IntlBackslash", '\\' },
            { "Space", ' ' },
            { "Enter", static_cast<juce::juce_wchar>(NSCarriageReturnCharacter) },
            { "Tab", static_cast<juce::juce_wchar>(NSTabCharacter) },
            { "Backspace", static_cast<juce::juce_wchar>(NSBackspaceCharacter) },
            { "Delete", static_cast<juce::juce_wchar>(NSDeleteCharacter) },
            { "Escape", static_cast<juce::juce_wchar>(0x001B) },
            { "NumpadDivide", '/' },
            { "NumpadMultiply", '*' },
            { "NumpadSubtract", '-' },
            { "NumpadAdd", '+' },
            { "NumpadDecimal", '.' },
            { "NumpadEqual", '=' },
            { "NumpadComma", ',' },
            { "NumpadEnter", static_cast<juce::juce_wchar>(NSEnterCharacter) },
        };

        if (const auto it = table.find(code); it != table.end())
            return it->second;

        if (code.startsWith("Numpad") && code.length() == 7)
        {
            const auto digit = code[6];
            if (juce::CharacterFunctions::isDigit(digit))
                return static_cast<juce::juce_wchar>(digit);
        }

        return std::nullopt;
    }

    static NSString* toNSString(const juce::String& str)
    {
        return str.isNotEmpty() ? juceStringToNS(str) : @"";
    }
} // namespace

bool KeyEventForwarder::dispatchKeyEventUsingCocoa(const juce::var& eventData, juce::Component* editorComponent)
{
    if (!isMessageThread())
        return false;

    if (editorComponent == nullptr)
        return false;

    if (auto* peer = editorComponent->getPeer())
    {
        if (auto* nsView = static_cast<NSView*>(peer->getNativeHandle()))
        {
            NSWindow* window = [nsView window];
            if (window == nil)
                window = [NSApp keyWindow];

            if (window == nil)
                return false;

            const juce::String type = eventData.getProperty("type", juce::var{}).toString();
            const bool isKeyDown = type.equalsIgnoreCase("keydown");
            const bool isKeyUp = type.equalsIgnoreCase("keyup");

            if (!isKeyDown && !isKeyUp)
                return false;

            const juce::String code = eventData.getProperty("code", juce::var{}).toString();
            auto macKeyCode = domCodeToMacKey(code);
            if (!macKeyCode.has_value())
            {
                const auto keyVar = eventData.getProperty("key", juce::var{});
                if (keyVar.isString())
                {
                    const juce::String keyStr = keyVar.toString();
                    if (keyStr.length() == 1)
                    {
                        const juce::juce_wchar ch = keyStr[0];
                        if (auto fromLayout = lookupMacKeyCodeFromUnicodeChar(ch))
                            macKeyCode = *fromLayout;
                    }
                }
            }

            const NSEventModifierFlags modifiers = makeModifierFlags(eventData, code);
            const bool isRepeat = static_cast<bool>(eventData.getProperty("repeat", false));

            const juce::String keyStr = eventData.getProperty("key", juce::var{}).toString();

            juce::String characters;
            juce::String charactersIgnoringModifiers;

            if (auto directChar = characterForDomKey(keyStr))
                characters = juce::String::charToString(*directChar);

            if (auto baseChar = baseCharacterForDomCode(code))
                charactersIgnoringModifiers = juce::String::charToString(*baseChar);

            if (characters.isEmpty() && charactersIgnoringModifiers.isNotEmpty())
            {
                characters = charactersIgnoringModifiers;
                if (static_cast<bool>(eventData.getProperty("shiftKey", false)))
                    characters = characters.toUpperCase();
            }

            if (charactersIgnoringModifiers.isEmpty())
                charactersIgnoringModifiers = characters;

            NSEventType nsType = isKeyDown ? NSEventTypeKeyDown : NSEventTypeKeyUp;

            NSEvent* event = [NSEvent keyEventWithType: nsType
                                              location: NSMakePoint(0.0, 0.0)
                                         modifierFlags: modifiers
                                             timestamp: [[NSProcessInfo processInfo] systemUptime]
                                          windowNumber: window.windowNumber
                                               context: nil
                                            characters: toNSString(characters)
                           charactersIgnoringModifiers: toNSString(charactersIgnoringModifiers)
                                             isARepeat: isRepeat
                                               keyCode: macKeyCode.value_or(0)];

            if (event == nil)
                return false;

            // Logic Pro (AU) での二重送信問題の対策:
            // keydown のみを転送し、keyup は送信しない
            // これにより Logic Pro が keydown を受け取った際に、自動的にペアとして処理されることを防ぐ
            if (isKeyUp)
            {
                // keyup は転送しない（Logic Pro では二重送信の原因となる）
                return true;
            }

            // keydown のみを postEvent で転送
            [window postEvent: event atStart: NO];
            return true;
        }
    }

    return false;
}

} // namespace zc

#endif // JUCE_MAC
