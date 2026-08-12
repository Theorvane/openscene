import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { Keyboard, ScrollView } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import type { ReactNode } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewProps } from 'react-native';

/**
 * A scroll view that lifts the field you just focused above the keyboard.
 *
 * Avoiding the keyboard is not the same as revealing the input. A
 * KeyboardAvoidingView shrinks the scrolling area, which is enough when the
 * field is near the top and useless when it is not: the provider list is long
 * enough that focusing a key field halfway down left it under the keyboard with
 * nothing to say it had moved. Android used to scroll the focused input into
 * view itself under `adjustResize`, which is one more thing edge-to-edge stopped
 * doing for us.
 *
 * The measurement is deliberately against the live keyboard frame rather than a
 * guessed height — keyboards differ by locale, by suggestion strip, and by
 * whether the emoji row is showing, and a guess is wrong in exactly the cases
 * that matter.
 */

/** Anything that can report where it is on screen — a TextInput or a View ref. */
type Measurable = {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
};

type Reveal = (node: Measurable | null) => void;

const RevealContext = createContext<Reveal>(() => {});

/** Call with the input's ref from its `onFocus`. A no-op outside a scroll view. */
export function useRevealOnFocus(): Reveal {
  return useContext(RevealContext);
}

/** Breathing room between the revealed field and the top of the keyboard. */
const GAP = 16;

/** Long enough for the keyboard slide and the avoiding view's resize to finish. */
const SETTLE_MS = 260;

export function KeyboardAwareScroll({
  scrollRef,
  children,
  onScroll,
  ...props
}: ScrollViewProps & { readonly scrollRef?: React.RefObject<ScrollView | null>; readonly children: ReactNode }) {
  const fallbackRef = useRef<ScrollView>(null);
  const scroller = scrollRef ?? fallbackRef;
  const offset = useRef(0);
  /**
   * A focus that never produces a keyboard leaves the listener waiting, because
   * it is what removes itself. Held here so unmounting takes both it and any
   * settle timer with it rather than leaving a closure over a dead screen.
   */
  const pending = useRef<{ subscription?: EmitterSubscription; timer?: ReturnType<typeof setTimeout> }>({});
  useEffect(
    () => () => {
      pending.current.subscription?.remove();
      if (pending.current.timer !== undefined) clearTimeout(pending.current.timer);
    },
    []
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll]
  );

  const reveal = useCallback<Reveal>(
    (node) => {
      if (node === null) return;
      const lift = (): void => {
        const metrics = Keyboard.metrics();
        if (metrics === undefined) return;
        node.measureInWindow((_x, y, _width, height) => {
          const overlap = y + height + GAP - metrics.screenY;
          // A couple of pixels is rounding, not occlusion.
          if (overlap > 4) scroller.current?.scrollTo({ y: offset.current + overlap, animated: true });
        });
      };
      /**
       * Twice, because the keyboard appearing is not one event but two moving
       * parts: the keyboard slides up and the KeyboardAvoidingView above it
       * shrinks to match. Measuring on the first of those reads a position the
       * second is still changing, which under-scrolls by however far the view
       * had left to travel — enough, on the provider sheet, to leave the field
       * sitting just under the keyboard rather than above it.
       *
       * The second pass costs nothing when the first was right: the field is
       * already clear, the overlap comes out negative, and nothing moves.
       */
      const liftTwice = (): void => {
        lift();
        if (pending.current.timer !== undefined) clearTimeout(pending.current.timer);
        pending.current.timer = setTimeout(lift, SETTLE_MS);
      };
      // Focus arrives before the keyboard has a frame to measure against, so on
      // the first field of a screen the work waits for the keyboard itself.
      if (Keyboard.isVisible()) {
        liftTwice();
        return;
      }
      pending.current.subscription?.remove();
      const subscription = Keyboard.addListener('keyboardDidShow', () => {
        subscription.remove();
        pending.current.subscription = undefined;
        liftTwice();
      });
      pending.current.subscription = subscription;
    },
    [scroller]
  );

  return (
    <RevealContext.Provider value={reveal}>
      <ScrollView ref={scroller} scrollEventThrottle={16} onScroll={handleScroll} {...props}>
        {children}
      </ScrollView>
    </RevealContext.Provider>
  );
}
