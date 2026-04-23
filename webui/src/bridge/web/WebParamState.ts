/**
 * juce-framework-frontend-mirror の SliderState / ToggleState / ComboBoxState の
 * Web 互換実装。JUCE WebView が無い環境でも同じインターフェースで動作する。
 */

type ListenerFn = () => void;

class SimpleEventEmitter
{
  private listeners = new Map<number, ListenerFn>();
  private nextId = 1;

  addListener(fn: ListenerFn): number
  {
    const id = this.nextId++;
    this.listeners.set(id, fn);
    return id;
  }

  removeListener(id: number): void { this.listeners.delete(id); }

  emit(): void { this.listeners.forEach((fn) => fn()); }
}

export interface WebSliderStateOptions
{
  defaultScaled?: number;
  min?: number;
  max?: number;
  /** 正規化 0..1 → スケール値 */
  toScaled?: (norm: number) => number;
  /** スケール値 → 正規化 0..1 */
  fromScaled?: (scaled: number) => number;
}

export class WebSliderState
{
  private scaledValue: number;
  private minV: number;
  private maxV: number;
  private toScaledFn: (n: number) => number;
  private fromScaledFn: (s: number) => number;
  public readonly valueChangedEvent = new SimpleEventEmitter();

  constructor(opts: WebSliderStateOptions = {})
  {
    this.minV = opts.min ?? 0;
    this.maxV = opts.max ?? 1;
    this.toScaledFn   = opts.toScaled   ?? ((n: number) => this.minV + n * (this.maxV - this.minV));
    this.fromScaledFn = opts.fromScaled ?? ((s: number) => (s - this.minV) / (this.maxV - this.minV));
    this.scaledValue = opts.defaultScaled ?? this.toScaledFn(0.5);
  }

  setNormalisedValue(norm: number): void
  {
    const clamped = Math.max(0, Math.min(1, norm));
    this.scaledValue = this.toScaledFn(clamped);
    this.valueChangedEvent.emit();
  }
  getNormalisedValue(): number
  {
    const n = this.fromScaledFn(this.scaledValue);
    return Math.max(0, Math.min(1, n));
  }
  getScaledValue(): number { return this.scaledValue; }
  setScaledValue(v: number): void
  {
    this.scaledValue = v;
    this.valueChangedEvent.emit();
  }

  /** juce 互換スタブ */
  sliderDragStarted(): void {}
  sliderDragEnded(): void {}
}

export class WebToggleState
{
  private value: boolean;
  public readonly valueChangedEvent = new SimpleEventEmitter();

  constructor(initial = false) { this.value = initial; }
  getValue(): boolean { return this.value; }
  setValue(v: boolean): void { this.value = v; this.valueChangedEvent.emit(); }
}

export class WebComboBoxState
{
  private index: number;
  private numItems: number;
  public readonly valueChangedEvent = new SimpleEventEmitter();

  constructor(initial = 0, numItems = 2) { this.index = initial; this.numItems = numItems; }

  getChoiceIndex(): number { return this.index; }
  setChoiceIndex(i: number): void
  {
    this.index = Math.max(0, Math.min(this.numItems - 1, i));
    this.valueChangedEvent.emit();
  }
  getNumItems(): number { return this.numItems; }
}
