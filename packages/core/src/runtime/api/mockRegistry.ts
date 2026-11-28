import type { MockInstance } from '../../types';

export type CleanupMethod = 'mockClear' | 'mockReset';
export type TrackedMock = {
  order: number;
  mock: Pick<MockInstance, CleanupMethod>;
  ref?: WeakRef<TrackedMock>;
};

export const isCleanupMethod = (key: PropertyKey): key is CleanupMethod =>
  key === 'mockClear' || key === 'mockReset';

// Recording or clearing a spy on Set.prototype must not call that spy again.
const { add, delete: remove, clear, has } = Set.prototype;

class MockIndex<T> {
  private values = new WeakMap<TrackedMock, T>();
  readonly refs: Set<WeakRef<TrackedMock>> = new Set();

  constructor(
    private readonly track: (mock: TrackedMock) => WeakRef<TrackedMock>,
  ) {}

  get(mock: TrackedMock): T | undefined {
    return this.values.get(mock);
  }

  set(mock: TrackedMock, value: T): void {
    this.values.set(mock, value);
    add.call(this.refs, this.track(mock));
  }

  delete(mock: TrackedMock): void {
    if (this.values.delete(mock) && mock.ref) remove.call(this.refs, mock.ref);
  }

  clear(): void {
    this.values = new WeakMap();
    clear.call(this.refs);
  }
}

export class MockRegistry<History, Config> {
  private nextOrder = 0;
  private onTrack?: (entry: TrackedMock) => void;
  private readonly targets = new WeakMap<object, TrackedMock>();
  private readonly collected = new FinalizationRegistry<WeakRef<TrackedMock>>(
    (ref) => {
      remove.call(this.histories.refs, ref);
      remove.call(this.configs.refs, ref);
      remove.call(this.overrides.mockClear.refs, ref);
      remove.call(this.overrides.mockReset.refs, ref);
    },
  );

  private readonly track = (mock: TrackedMock): WeakRef<TrackedMock> => {
    this.onTrack?.(mock);
    if (!mock.ref) {
      mock.ref = new WeakRef(mock);
      this.collected.register(mock, mock.ref);
    }
    return mock.ref;
  };

  readonly histories: MockIndex<History> = new MockIndex(this.track);
  readonly configs: MockIndex<Config> = new MockIndex(this.track);
  readonly restores: Set<WeakRef<() => void>> = new Set();
  private readonly overrides = {
    mockClear: new MockIndex<Map<object, unknown>>(this.track),
    mockReset: new MockIndex<Map<object, unknown>>(this.track),
  };

  register(target: object, entry: TrackedMock): void {
    entry.order = ++this.nextOrder;
    this.targets.set(target, entry);
    if (entry.ref) this.onTrack?.(entry);
  }

  watchRealmWrapper(target: object, entry: TrackedMock): void {
    this.targets.set(target, entry);
    // A static setter on the supplied implementation may already have replaced
    // a helper before the VM copied its descriptor.
    if (entry.ref) {
      for (const key of ['mockClear', 'mockReset'] as const) {
        if (this.overrides[key].get(entry)) {
          this.recordOverride(entry, target, key, undefined);
        }
      }
    }
  }

  // The host function and its VM wrapper can be modified independently. Store
  // their original methods only while an override exists, without invoking getters.
  recordOverride(
    entry: TrackedMock,
    target: object,
    key: CleanupMethod,
    previous: unknown,
  ): void {
    const index = this.overrides[key];
    const changed = index.get(entry);
    const original = changed?.has(target) ? changed.get(target) : previous;
    if (
      typeof original === 'function' &&
      Object.getOwnPropertyDescriptor(target, key)?.value === original
    ) {
      changed?.delete(target);
      if (changed?.size === 0) index.delete(entry);
    } else if (changed) {
      changed.set(target, original);
    } else {
      index.set(entry, new Map([[target, original]]));
    }
  }

  private change(
    target: object,
    key: PropertyKey,
    apply: () => boolean,
  ): boolean {
    if (!isCleanupMethod(key)) return apply();
    const entry = this.targets.get(target);
    if (!entry) return apply();
    const previous = Object.getOwnPropertyDescriptor(target, key)?.value;
    if (!apply()) return false;
    this.recordOverride(entry, target, key, previous);
    return true;
  }

  readonly traps: Pick<
    ProxyHandler<object>,
    'defineProperty' | 'deleteProperty'
  > = {
    defineProperty: (
      target: object,
      key: PropertyKey,
      descriptor: PropertyDescriptor,
    ): boolean =>
      this.change(target, key, () =>
        Reflect.defineProperty(target, key, descriptor),
      ),
    deleteProperty: (target: object, key: PropertyKey): boolean =>
      this.change(target, key, () => Reflect.deleteProperty(target, key)),
  };

  discard(reset: boolean): void {
    this.histories.clear();
    if (reset) this.configs.clear();
  }

  clean(method: CleanupMethod): void {
    const reset = method === 'mockReset';
    const { mockClear, mockReset } = this.overrides;
    // A native mock's default mockReset delegates to its own mockClear.
    if (!mockClear.refs.size && !(reset && mockReset.refs.size)) {
      this.discard(reset);
      return;
    }

    const indexes = reset
      ? [this.histories, this.configs, mockClear, mockReset]
      : [this.histories, mockClear];
    const candidates = new Set<TrackedMock>();
    for (const index of indexes) {
      for (const ref of index.refs) {
        const entry = ref.deref();
        if (entry) add.call(candidates, entry);
        else remove.call(index.refs, ref);
      }
    }

    // A hook can inspect another mock, throw, or make a later mock dirty.
    // Only insert newly eligible mocks whose turn has not already passed.
    const byOrder = (a: TrackedMock, b: TrackedMock) => b.order - a.order;
    const pending = [...candidates].sort(byOrder);
    let last = 0;
    let needsSort = false;
    const previous = this.onTrack;
    this.onTrack = (entry) => {
      previous?.(entry);
      if (entry.order > last && !has.call(candidates, entry)) {
        add.call(candidates, entry);
        pending.push(entry);
        needsSort = true;
      }
    };
    try {
      while (pending.length) {
        const entry = pending.pop()!;
        last = entry.order;
        if (mockClear.get(entry) || (reset && mockReset.get(entry))) {
          entry.mock[method]();
          if (needsSort) {
            pending.sort(byOrder);
            needsSort = false;
          }
        } else {
          this.histories.delete(entry);
          if (reset) this.configs.delete(entry);
        }
      }
    } finally {
      this.onTrack = previous;
    }
  }
}
