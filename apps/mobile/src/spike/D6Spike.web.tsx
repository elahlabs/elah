import { Pressable, StyleSheet, Text, View } from 'react-native'

/**
 * Web stand-in for the RN-P6 D6 spike. The real screen imports native-only
 * modules (Nitro, react-native-webgpu, the spike modules) that reach React
 * Native internals react-native-web does not have, so Metro's `.web` platform
 * extension swaps this file in on the web target.
 */
export default function D6Spike({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>RN-P6 · D6 spike</Text>
      <Text style={styles.muted}>Native only: open it in the iOS or Android development build.</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}>
        <Text style={styles.buttonLabel}>Close</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { color: '#f2f3f5', fontSize: 20, fontWeight: '600' },
  muted: { color: '#8b919c', fontSize: 13 },
  button: { backgroundColor: '#262b35', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, alignSelf: 'flex-start' },
  buttonLabel: { color: '#f2f3f5', fontSize: 14 },
})
