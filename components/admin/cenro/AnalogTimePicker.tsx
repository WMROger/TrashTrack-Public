import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Dimensions } from 'react-native';

interface AnalogTimePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (hours24: number, minutes: number) => void;
  initialHours24?: number;
  initialMinutes?: number;
}

export default function AnalogTimePicker({ visible, onClose, onSelect, initialHours24 = 0, initialMinutes = 0 }: AnalogTimePickerProps) {
  const [mode, setMode] = useState<'hours' | 'minutes'>('hours');
  
  // Internal state for the picker
  const [hours, setHours] = useState(initialHours24 % 12 || 12);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [isPM, setIsPM] = useState(initialHours24 >= 12);

  useEffect(() => {
    if (visible) {
      setHours(initialHours24 % 12 || 12);
      setMinutes(initialMinutes);
      setIsPM(initialHours24 >= 12);
      setMode('hours');
    }
  }, [visible, initialHours24, initialMinutes]);

  const handleConfirm = () => {
    let final24 = hours;
    if (isPM && hours !== 12) final24 += 12;
    if (!isPM && hours === 12) final24 = 0;
    
    onSelect(final24, minutes);
    onClose();
  };

  const CLOCK_RADIUS = 100;
  const CENTER = 120; // 240 / 2
  const NUMBER_RADIUS = 80;

  const renderNumbers = () => {
    const items = [];
    for (let i = 1; i <= 12; i++) {
      const val = mode === 'hours' ? i : (i === 12 ? 0 : i * 5);
      const displayVal = val.toString().padStart(2, '0');
      
      const angle = i * 30 * (Math.PI / 180);
      const left = CENTER + NUMBER_RADIUS * Math.sin(angle) - 16;
      const top = CENTER - NUMBER_RADIUS * Math.cos(angle) - 16;
      
      const isSelected = mode === 'hours' ? hours === val : minutes === val;

      items.push(
        <TouchableOpacity
          key={i}
          style={[
            styles.numberBubble,
            { left, top },
            isSelected && styles.numberBubbleSelected
          ]}
          onPress={() => {
            if (mode === 'hours') {
              setHours(val);
              setTimeout(() => setMode('minutes'), 300); // auto switch to minutes
            } else {
              setMinutes(val);
            }
          }}
        >
          <Text style={[styles.numberText, isSelected && styles.numberTextSelected]}>
            {mode === 'hours' ? val.toString() : displayVal}
          </Text>
        </TouchableOpacity>
      );
    }
    return items;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.timeDisplay}>
              <TouchableOpacity onPress={() => setMode('hours')}>
                <Text style={[styles.timeText, mode === 'hours' && styles.timeTextActive]}>
                  {hours.toString().padStart(2, '0')}
                </Text>
              </TouchableOpacity>
              <Text style={styles.timeColon}>:</Text>
              <TouchableOpacity onPress={() => setMode('minutes')}>
                <Text style={[styles.timeText, mode === 'minutes' && styles.timeTextActive]}>
                  {minutes.toString().padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.ampmContainer}>
              <TouchableOpacity style={[styles.ampmBtn, !isPM && styles.ampmBtnActive]} onPress={() => setIsPM(false)}>
                <Text style={[styles.ampmText, !isPM && styles.ampmTextActive]}>AM</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.ampmBtn, isPM && styles.ampmBtnActive]} onPress={() => setIsPM(true)}>
                <Text style={[styles.ampmText, isPM && styles.ampmTextActive]}>PM</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Clock Face */}
          <View style={styles.clockContainer}>
            <View style={styles.clockFace}>
              <View style={styles.centerDot} />
              {renderNumbers()}
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={onClose}>
              <Text style={styles.actionText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleConfirm}>
              <Text style={[styles.actionText, { color: '#059669', fontWeight: 'bold' }]}>OK</Text>
            </TouchableOpacity>
          </View>

        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32
  },
  timeDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline'
  },
  timeText: {
    fontSize: 42,
    fontWeight: '300',
    color: '#9CA3AF'
  },
  timeTextActive: {
    color: '#059669',
    fontWeight: '500'
  },
  timeColon: {
    fontSize: 42,
    fontWeight: '300',
    color: '#9CA3AF',
    marginHorizontal: 4
  },
  ampmContainer: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    overflow: 'hidden'
  },
  ampmBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  ampmBtnActive: {
    backgroundColor: '#059669'
  },
  ampmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280'
  },
  ampmTextActive: {
    color: '#fff'
  },
  clockContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24
  },
  clockFace: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#F3F4F6',
    position: 'relative'
  },
  centerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#059669',
    position: 'absolute',
    top: 116,
    left: 116
  },
  numberBubble: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberBubbleSelected: {
    backgroundColor: '#059669'
  },
  numberText: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '500'
  },
  numberTextSelected: {
    color: '#fff',
    fontWeight: 'bold'
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16
  },
  actionBtn: {
    padding: 8
  },
  actionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280'
  }
});
