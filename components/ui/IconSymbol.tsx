// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  'chevron.down': 'keyboard-arrow-down',
  'message.fill': 'chat',
  'person.circle.fill': 'person',
  'rectangle.portrait.and.arrow.right': 'logout',
  'leaf.fill': 'eco',
  'arrow.triangle.2.circlepath': 'refresh',
  'chart.line.uptrend.xyaxis': 'trending-up',
  'person.fill': 'person',
  'person.circle': 'person',
  'bell': 'notifications',
  'bell.badge.fill': 'notifications-active',
  'lock': 'lock',
  'lock.shield.fill': 'security',
  'gear': 'settings',
  'questionmark.circle': 'help',
  'questionmark.circle.fill': 'help',
  'info.circle': 'info',
  'info.circle.fill': 'info',
  'pencil': 'edit',
  'ellipsis': 'more-horiz',
  'xmark': 'close',
  'camera.fill': 'camera-alt',
  'sun.max.fill': 'wb-sunny',
  'moon.fill': 'nightlight-round',
  'shield.fill': 'security',
  'door.left.hand.open': 'logout',
  // Additional icons used by new tabs
  'calendar': 'event',
  'hand.thumbsup': 'thumb-up',
  'mappin.and.ellipse': 'location-on',
  'star.fill': 'star',
  'hand.thumbsdown': 'thumb-down',
  // Missing icons from recent redesign
  'clock': 'access-time',
  'megaphone.fill': 'campaign',
  'camera': 'photo-camera',
  'gift': 'card-giftcard',
  'sparkles': 'auto-awesome',
  'scalemass.fill': 'monitor-weight',
  'mappin.circle.fill': 'place',
  'location.fill': 'location-on',
  'star.circle.fill': 'stars',
  // Additional useful icons
  'phone.fill': 'phone',
  'envelope.fill': 'email',
  'map.fill': 'map',
  'clock.fill': 'access-time',
  'heart': 'favorite-border',
  'heart.fill': 'favorite',
  'bookmark.fill': 'bookmark',
  'share.fill': 'share',
  'download.fill': 'download',
  'upload.fill': 'upload',
  'trash.fill': 'delete',
  'plus.circle.fill': 'add-circle',
  'minus.circle.fill': 'remove-circle',
  'checkmark.circle.fill': 'check-circle',
  'exclamationmark.triangle.fill': 'warning',
  'exclamationmark.circle.fill': 'error',
  'checkmark': 'check',
  'xmark.circle.fill': 'cancel',
  'arrow.up': 'keyboard-arrow-up',
  'arrow.down': 'keyboard-arrow-down',
  'arrow.left': 'keyboard-arrow-left',
  'arrow.right': 'keyboard-arrow-right',
  'magnifyingglass': 'search',
  'slider.horizontal.3': 'tune',
  'line.3.horizontal': 'menu',
  'square.and.arrow.up': 'share',
  'square.and.arrow.down': 'file-download',
  'doc.text.fill': 'description',
  'folder.fill': 'folder',
  'photo.fill': 'photo',
  'video.fill': 'videocam',
  'mic.fill': 'mic',
  'speaker.fill': 'volume-up',
  'speaker.slash.fill': 'volume-off',
  'wifi': 'wifi',
  'battery.100': 'battery-full',
  'battery.75': 'battery-6-bar',
  'battery.50': 'battery-4-bar',
  'battery.25': 'battery-2-bar',
  'battery.0': 'battery-0-bar',
  // Visibility / Eye icons
  'eye': 'visibility',
  'eye.slash': 'visibility-off',
  'eye.fill': 'visibility',
  'eye.slash.fill': 'visibility-off',
  // Missing icons in schedule, announcements, profile, settings, modals
  'map': 'map',
  'car': 'directions-car',
  'car.fill': 'directions-car',
  'chevron.up': 'keyboard-arrow-up',
  'recycling': 'recycling',
  'repeat': 'repeat',
  'note': 'notes',
  'note.text': 'notes',
  'cellularbars': 'signal-cellular-alt',
  'line.3.horizontal.decrease': 'filter-list',
  'exclamationmark.triangle': 'warning',
  'doc.text': 'description',
  'mappin.circle': 'place',
  'leaf': 'eco',
  'envelope': 'email',
  'book': 'menu-book',
  'cube.fill': 'view-in-ar',
  'drop.fill': 'water-drop',
  'truck': 'local-shipping',
  'truck.fill': 'local-shipping',
  'trophy': 'emoji-events',
  'trophy.fill': 'emoji-events',
  'medal': 'military-tech',
  'medal.fill': 'military-tech',
  'arrow.up.left.and.arrow.down.right': 'fullscreen',
  'arrow.down.right.and.arrow.up.left': 'fullscreen-exit',
} as IconMapping;

/**
 * An icon component that uses Material Icons on all platforms.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName | string;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
}) {
  const iconName = (MAPPING as Record<string, ComponentProps<typeof MaterialIcons>['name']>)[name] || 'help-outline';
  return <MaterialIcons color={color} size={size} name={iconName} style={style} />;
}
