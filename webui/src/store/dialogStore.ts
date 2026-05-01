// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import { create } from 'zustand';

interface DialogButton {
  text: string;
  color?:
    | 'inherit'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'error'
    | 'info'
    | 'warning';
  variant?: 'text' | 'outlined' | 'contained';
}

interface DialogInputOptions {
  // テキスト入力フィールドのラベル
  label?: string;
  // プレースホルダー
  placeholder?: string;
  // 初期値
  defaultValue?: string;
  // 必須入力（trueの場合、空文字では確定できない）
  required?: boolean;
  // 入力検証（エラーメッセージを返すと無効、null/空文字で有効）
  validate?: (value: string) => string | null;
  // TextFieldのtype
  type?: 'text' | 'number' | 'password';
  // ヘルパーテキスト（任意）
  helperText?: string;
}

interface DialogOptions {
  title: string;
  content: string | React.ReactNode;
  primaryButton?: DialogButton;
  secondaryButton?: DialogButton;
  tertiaryButton?: DialogButton;
  // 入力フィールドを有効化する場合に指定
  input?: DialogInputOptions;
}

interface DialogState {
  isOpen: boolean;
  options: DialogOptions | null;
  resolve: ((value: string | null) => void) | null;
}

interface DialogStore extends DialogState {
  showDialog: (options: DialogOptions) => Promise<string | null>;
  handleClose: (result: string | null) => void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  isOpen: false,
  options: null,
  resolve: null,

  showDialog: (options: DialogOptions) => {
    return new Promise<string | null>((resolve) => {
      set({
        isOpen: true,
        options,
        resolve,
      });
    });
  },

  handleClose: (result: string | null) => {
    const { resolve } = get();
    if (resolve) {
      resolve(result);
    }
    set({
      isOpen: false,
      options: null,
      resolve: null,
    });
  },
}));

export const showDialog = (options: DialogOptions) => {
  return useDialogStore.getState().showDialog(options);
};

// 入力値を取得するためのヘルパー。
// 仕様:
// - 入力が有効なダイアログで「primaryButton」（未指定時はOK）が押された場合、入力値を返す
// - Esc/Backdrop/×、またはprimary以外のボタンで閉じた場合はnullを返す
// エラー通知用のヘルパー関数
export const showErrorDialog = (message: string, details?: string) => {
  return showDialog({
    title: 'Error',
    content: details ? `${message}\n\n${details}` : message,
    primaryButton: {
      text: 'OK',
      color: 'error',
    },
  });
};

export const showWarningDialog = (message: string, details?: string) => {
  return showDialog({
    title: 'Warning',
    content: details ? `${message}\n\n${details}` : message,
    primaryButton: {
      text: 'OK',
      color: 'warning',
    },
  });
};

export const showInfoDialog = (message: string, details?: string) => {
  return showDialog({
    title: 'Information',
    content: details ? `${message}\n\n${details}` : message,
    primaryButton: {
      text: 'OK',
      color: 'info',
    },
  });
};

export const showInputDialog = async (
  options: Omit<DialogOptions, 'content'> & {
    content: DialogOptions['content'];
    input: DialogInputOptions;
  },
): Promise<string | null> => {
  // showDialogは文字列（ボタンテキスト or 入力値）またはnullを返す。
  // GlobalDialog側でprimary選択時に入力値を返す実装にしているため、
  // ここではそれをそのまま採用し、その他の戻りはnullに正規化する。
  const primaryText = options.primaryButton?.text ?? 'OK';
  const secondaryText = options.secondaryButton?.text;
  const tertiaryText = options.tertiaryButton?.text;
  const result = await showDialog(options);
  if (result === null) return null;
  // 入力モードではprimary押下時に入力値が返る想定。
  // secondary/tertiaryを押した場合はresultがそのボタンラベルになるためnullを返す。
  // また、ユーザーが偶然ボタンラベル（例: "保存" や "キャンセル"）そのものを入力した場合も
  // キャンセル扱い（null）に正規化して安全側に倒す。
  if (result === primaryText) return null;
  if (secondaryText && result === secondaryText) return null;
  if (tertiaryText && result === tertiaryText) return null;
  return typeof result === 'string' ? result : null;
};
