import { Fragment } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { splitBold } from '../lib/chatMarkdown';

/** An assistant reply, with the emphasis rendered rather than spelled out. */
export function ChatText({ children, style }: { readonly children: string; readonly style?: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {splitBold(children).map((run, index) => (
        <Fragment key={index}>{run.bold ? <Text style={styles.bold}>{run.text}</Text> : run.text}</Fragment>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' }
});
