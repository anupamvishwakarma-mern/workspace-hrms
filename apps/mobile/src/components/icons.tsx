import { Text, View, type ColorValue } from 'react-native';

export type IconName =
  | 'clock'
  | 'calendar'
  | 'inbox'
  | 'user'
  | 'check'
  | 'info'
  | 'alert'
  | 'team'
  | 'grid'
  | 'doc'
  | 'wallet'
  | 'globe'
  | 'gear'
  | 'book'
  | 'leaf'
  | 'chevron';

/** Tiny dependency-free icons drawn with Views, so no icon font or SVG package is needed. */
export function Icon({
  name,
  color,
  size = 22,
}: {
  name: IconName;
  color: ColorValue;
  size?: number;
}) {
  const w = Math.max(1.75, size / 11);
  const box = {
    width: size,
    height: size,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
  switch (name) {
    case 'clock':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: w,
              height: size * 0.3,
              backgroundColor: color,
              top: size * 0.2,
              borderRadius: w,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: size * 0.22,
              height: w,
              backgroundColor: color,
              left: size * 0.5,
              top: size * 0.5 - w / 2,
              borderRadius: w,
            }}
          />
        </View>
      );
    case 'calendar':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size,
              height: size * 0.88,
              borderRadius: size * 0.2,
              borderWidth: w,
              borderColor: color,
              marginTop: size * 0.08,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: size * 0.34,
              width: size,
              height: w,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: size * 0.26,
              width: w,
              height: size * 0.2,
              backgroundColor: color,
              borderRadius: w,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: size * 0.26,
              width: w,
              height: size * 0.2,
              backgroundColor: color,
              borderRadius: w,
            }}
          />
        </View>
      );
    case 'inbox':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size,
              height: size * 0.82,
              borderRadius: size * 0.2,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: size * 0.3,
              width: size * 0.5,
              height: w,
              backgroundColor: color,
              borderRadius: w,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: size * 0.5,
              width: size * 0.34,
              height: w,
              backgroundColor: color,
              borderRadius: w,
            }}
          />
        </View>
      );
    case 'user':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size * 0.42,
              height: size * 0.42,
              borderRadius: size,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: size * 0.8,
              height: size * 0.4,
              marginTop: size * 0.08,
              borderTopLeftRadius: size,
              borderTopRightRadius: size,
              borderWidth: w,
              borderBottomWidth: 0,
              borderColor: color,
            }}
          />
        </View>
      );
    case 'team':
      return (
        <View
          style={{ ...box, flexDirection: 'row' }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <View style={{ marginRight: -size * 0.18 }}>
            <Icon name="user" color={color} size={size * 0.78} />
          </View>
          <View style={{ marginTop: size * 0.12 }}>
            <Icon name="user" color={color} size={size * 0.78} />
          </View>
        </View>
      );
    case 'grid':
      return (
        <View
          style={{ ...box, flexWrap: 'wrap', flexDirection: 'row', gap: size * 0.12 }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={{
                width: size * 0.4,
                height: size * 0.4,
                borderRadius: size * 0.1,
                borderWidth: w,
                borderColor: color,
              }}
            />
          ))}
        </View>
      );
    case 'doc':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size * 0.78,
              height: size,
              borderRadius: size * 0.16,
              borderWidth: w,
              borderColor: color,
            }}
          />
          {[0.3, 0.5, 0.7].map((y, i) => (
            <View
              key={y}
              style={{
                position: 'absolute',
                top: size * y,
                width: size * (i === 2 ? 0.26 : 0.4),
                height: w,
                backgroundColor: color,
                borderRadius: w,
                left: size * 0.24,
              }}
            />
          ))}
        </View>
      );
    case 'wallet':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size,
              height: size * 0.78,
              borderRadius: size * 0.2,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: size * 0.14,
              width: size * 0.2,
              height: size * 0.2,
              borderRadius: size,
              borderWidth: w,
              borderColor: color,
            }}
          />
        </View>
      );
    case 'globe':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: size * 0.45,
              height: size,
              borderRadius: size,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View style={{ position: 'absolute', width: size, height: w, backgroundColor: color }} />
        </View>
      );
    case 'gear':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size,
              borderWidth: w * 1.8,
              borderColor: color,
              borderStyle: 'dashed',
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: size * 0.34,
              height: size * 0.34,
              borderRadius: size,
              borderWidth: w,
              borderColor: color,
            }}
          />
        </View>
      );
    case 'book':
      return (
        <View
          style={{ ...box, flexDirection: 'row' }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <View
            style={{
              width: size * 0.48,
              height: size * 0.82,
              borderTopLeftRadius: size * 0.2,
              borderBottomLeftRadius: size * 0.2,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: size * 0.48,
              height: size * 0.82,
              borderTopRightRadius: size * 0.2,
              borderBottomRightRadius: size * 0.2,
              borderWidth: w,
              borderColor: color,
              borderLeftWidth: 0,
            }}
          />
        </View>
      );
    case 'leaf':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size * 0.82,
              height: size * 0.82,
              borderTopLeftRadius: size,
              borderBottomRightRadius: size,
              borderTopRightRadius: size * 0.1,
              borderBottomLeftRadius: size * 0.1,
              borderWidth: w,
              borderColor: color,
            }}
          />
        </View>
      );
    case 'chevron':
      return (
        <View style={box} accessibilityElementsHidden importantForAccessibility="no">
          <View
            style={{
              width: size * 0.42,
              height: size * 0.42,
              borderTopWidth: w,
              borderRightWidth: w,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      );
    default: {
      const glyph = name === 'check' ? '✓' : name === 'alert' ? '!' : 'i';
      return (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            ...box,
            borderRadius: size,
            borderWidth: w,
            borderColor: color,
          }}
        >
          <Glyph color={color} size={size * 0.62} text={glyph} />
        </View>
      );
    }
  }
}

function Glyph({ color, size, text }: { color: ColorValue; size: number; text: string }) {
  return (
    <Text style={{ color, fontSize: size, fontWeight: '800', lineHeight: size * 1.15 }}>
      {text}
    </Text>
  );
}
