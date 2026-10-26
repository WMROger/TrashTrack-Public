import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export interface ImageCropModalProps {
  visible: boolean;
  imageUri: string | null | undefined;
  cropType: 'cenro-logo' | 'cicto-logo' | 'background';
  onClose: () => void;
  onApplyCrop: (croppedUri: string) => Promise<void>;
}

export function ImageCropModal({
  visible,
  imageUri,
  cropType,
  onClose,
  onApplyCrop,
}: ImageCropModalProps) {
  const { width: windowWidth } = useWindowDimensions();

  const isLogo = cropType === 'cenro-logo' || cropType === 'cicto-logo';
  const isCenro = cropType === 'cenro-logo';
  const isCicto = cropType === 'cicto-logo';

  const themeColor = isCenro ? '#059669' : isCicto ? '#0D9488' : '#047857';
  const agencyName = isCenro ? 'CENRO Environmental Seal' : isCicto ? 'CICTO Technology Emblem' : 'Landing Portal Background';
  const title = `Crop ${agencyName}`;
  const subtitle = isLogo
    ? 'Aspect ratio locked to 1:1 Square (Ideal for badges, seals & circular navigation)'
    : 'Aspect ratio locked to 16:9 Landscape (Ideal for widescreen portal background)';

  // Dimensions of the viewport crop box on screen
  const cropBoxWidth = useMemo(() => {
    if (isLogo) {
      return Math.min(360, Math.max(260, windowWidth - 60));
    } else {
      return Math.min(500, Math.max(300, windowWidth - 60));
    }
  }, [isLogo, windowWidth]);

  const cropBoxHeight = useMemo(() => {
    if (isLogo) {
      return cropBoxWidth; // 1:1 square
    } else {
      return Math.round((cropBoxWidth * 9) / 16); // 16:9 widescreen
    }
  }, [isLogo, cropBoxWidth]);

  // Image natural dimensions
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [showCircleGuide, setShowCircleGuide] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initPanX: number;
    initPanY: number;
  } | null>(null);

  // Load natural dimensions whenever imageUri changes
  useEffect(() => {
    if (!visible || !imageUri) {
      setNaturalSize(null);
      setPan({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setIsProcessing(false);
      return;
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const img = new (window as any).Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setNaturalSize({
          width: img.naturalWidth || img.width || 800,
          height: img.naturalHeight || img.height || 800,
        });
      };
      img.onerror = () => {
        // Fallback dimensions if loading error
        setNaturalSize({ width: 800, height: 800 });
      };
      img.src = imageUri;
    } else {
      setNaturalSize({ width: 800, height: 800 });
    }
  }, [visible, imageUri]);

  // Base scale calculation to ensure the image fully covers the crop box at zoom = 1
  const { renderedWidth, renderedHeight, maxPanX, maxPanY } = useMemo(() => {
    if (!naturalSize) {
      return { renderedWidth: cropBoxWidth, renderedHeight: cropBoxHeight, maxPanX: 0, maxPanY: 0 };
    }

    const isRotatedSideways = rotation % 180 !== 0;
    const effectiveWidth = isRotatedSideways ? naturalSize.height : naturalSize.width;
    const effectiveHeight = isRotatedSideways ? naturalSize.width : naturalSize.height;

    const baseScale = Math.max(
      cropBoxWidth / effectiveWidth,
      cropBoxHeight / effectiveHeight
    );
    const currentScale = baseScale * zoom;

    const rWidth = naturalSize.width * currentScale;
    const rHeight = naturalSize.height * currentScale;

    const screenWidth = isRotatedSideways ? rHeight : rWidth;
    const screenHeight = isRotatedSideways ? rWidth : rHeight;

    const mPanX = Math.max(0, (screenWidth - cropBoxWidth) / 2);
    const mPanY = Math.max(0, (screenHeight - cropBoxHeight) / 2);

    return {
      renderedWidth: rWidth,
      renderedHeight: rHeight,
      maxPanX: mPanX,
      maxPanY: mPanY,
    };
  }, [naturalSize, cropBoxWidth, cropBoxHeight, rotation, zoom]);

  // Keep pan bounded within maxPanX, maxPanY whenever scale/rotation changes
  useEffect(() => {
    setPan((prev) => ({
      x: Math.min(maxPanX, Math.max(-maxPanX, prev.x)),
      y: Math.min(maxPanY, Math.max(-maxPanY, prev.y)),
    }));
  }, [maxPanX, maxPanY]);

  // Global mouse event listeners during web dragging
  useEffect(() => {
    if (!isDragging || Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaX = e.clientX - dragStartRef.current.startX;
      const deltaY = e.clientY - dragStartRef.current.startY;

      const targetX = dragStartRef.current.initPanX + deltaX;
      const targetY = dragStartRef.current.initPanY + deltaY;

      setPan({
        x: Math.min(maxPanX, Math.max(-maxPanX, targetX)),
        y: Math.min(maxPanY, Math.max(-maxPanY, targetY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, maxPanX, maxPanY]);

  // Mouse / Touch handlers for the viewport
  const handleMouseDown = (e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX ?? 0,
      startY: e.clientY ?? 0,
      initPanX: pan.x,
      initPanY: pan.y,
    };
  };

  const handleTouchStart = (e: any) => {
    const touch = e.touches?.[0];
    if (!touch) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: touch.clientX ?? touch.pageX ?? 0,
      startY: touch.clientY ?? touch.pageY ?? 0,
      initPanX: pan.x,
      initPanY: pan.y,
    };
  };

  const handleTouchMove = (e: any) => {
    if (!isDragging || !dragStartRef.current) return;
    const touch = e.touches?.[0];
    if (!touch) return;
    const deltaX = (touch.clientX ?? touch.pageX ?? 0) - dragStartRef.current.startX;
    const deltaY = (touch.clientY ?? touch.pageY ?? 0) - dragStartRef.current.startY;

    setPan({
      x: Math.min(maxPanX, Math.max(-maxPanX, dragStartRef.current.initPanX + deltaX)),
      y: Math.min(maxPanY, Math.max(-maxPanY, dragStartRef.current.initPanY + deltaY)),
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleWheel = (e: any) => {
    if (Platform.OS !== 'web') return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((prev) => Math.min(3, Math.max(1, Math.round((prev + delta) * 100) / 100)));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleReset = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
  };

  // Perform canvas cropping and export
  const handleApply = async () => {
    if (!imageUri) return;
    setIsProcessing(true);

    try {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const outW = isLogo ? 1024 : 1920;
        const outH = isLogo ? 1024 : 1080;
        const mimeType = isLogo ? 'image/png' : 'image/jpeg';
        const quality = isLogo ? 1.0 : 0.92;

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to initialize 2D canvas context');
        }

        ctx.clearRect(0, 0, outW, outH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Load image into an HTMLImageElement
        const img = new (window as any).Image();
        img.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image for cropping'));
          img.src = imageUri;
        });

        // 1. Move to canvas center
        ctx.translate(outW / 2, outH / 2);

        // 2. Translate in screen coordinates scaled to canvas resolution
        const scaleMultiplier = outW / cropBoxWidth;
        ctx.translate(pan.x * scaleMultiplier, pan.y * scaleMultiplier);

        // 3. Rotate around image center
        ctx.rotate((rotation * Math.PI) / 180);

        // 4. Draw image centered
        const drawWidth = renderedWidth * scaleMultiplier;
        const drawHeight = renderedHeight * scaleMultiplier;
        ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

        // 5. Convert to Blob URL
        const blobUrl = await new Promise<string>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Canvas export failed'));
                return;
              }
              const url = URL.createObjectURL(blob);
              resolve(url);
            },
            mimeType,
            quality
          );
        });

        await onApplyCrop(blobUrl);
      } else {
        // Fallback for non-web environments
        await onApplyCrop(imageUri);
      }
    } catch (err: any) {
      console.error('Crop export error:', err);
      alert(err?.message || 'Error processing cropped image');
      setIsProcessing(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.headerIconCircle, { backgroundColor: `${themeColor}15` }]}>
              <MaterialIcons
                name={isCenro ? 'eco' : isCicto ? 'security' : 'wallpaper'}
                size={22}
                color={themeColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.headerTitle}>{title}</Text>
                <View style={[styles.ratioBadge, { backgroundColor: `${themeColor}20` }]}>
                  <Text style={[styles.ratioBadgeText, { color: themeColor }]}>
                    {isLogo ? '1:1 SQUARE' : '16:9 WIDESCREEN'}
                  </Text>
                </View>
              </View>
              <Text style={styles.headerSubtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              disabled={isProcessing}
              activeOpacity={0.7}
            >
              <MaterialIcons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Stage Area */}
          <View style={styles.stage}>
            <Text style={styles.instructionText}>
              <MaterialIcons name="touch-app" size={13} color="#94A3B8" /> Drag image to position • Scroll or slider to zoom
            </Text>

            {/* Viewport Frame */}
            <View
              style={[
                styles.cropViewport,
                {
                  width: cropBoxWidth,
                  height: cropBoxHeight,
                  borderColor: themeColor,
                },
                Platform.OS === 'web' && ({ cursor: isDragging ? 'grabbing' : 'grab' } as any),
              ]}
              // @ts-ignore Web event listeners
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onWheel={handleWheel}
            >
              {/* Background dark fill */}
              <View style={styles.viewportBg} />

              {/* Transformed Image Container */}
              {imageUri && naturalSize && (
                <View
                  style={{
                    position: 'absolute',
                    left: cropBoxWidth / 2,
                    top: cropBoxHeight / 2,
                    transform: [{ translateX: pan.x }, { translateY: pan.y }],
                    pointerEvents: 'none',
                  }}
                >
                  {Platform.OS === 'web' ? (
                    <img
                      src={imageUri}
                      alt="Crop target"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        left: -renderedWidth / 2,
                        top: -renderedHeight / 2,
                        width: renderedWidth,
                        height: renderedHeight,
                        transform: `rotate(${rotation}deg)`,
                        transformOrigin: 'center center',
                        userSelect: 'none',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        position: 'absolute',
                        left: -renderedWidth / 2,
                        top: -renderedHeight / 2,
                        width: renderedWidth,
                        height: renderedHeight,
                        transform: [{ rotate: `${rotation}deg` }],
                      }}
                    />
                  )}
                </View>
              )}

              {/* Grid Lines Overlay */}
              <View style={styles.gridOverlay} pointerEvents="none">
                <View style={[styles.gridLineV, { left: '33.33%' }]} />
                <View style={[styles.gridLineV, { left: '66.66%' }]} />
                <View style={[styles.gridLineH, { top: '33.33%' }]} />
                <View style={[styles.gridLineH, { top: '66.66%' }]} />
              </View>

              {/* Optional Circular Mask Guide for Logos */}
              {isLogo && showCircleGuide && (
                <View
                  style={[
                    styles.circleGuide,
                    {
                      width: cropBoxWidth - 4,
                      height: cropBoxHeight - 4,
                      borderRadius: (cropBoxWidth - 4) / 2,
                    },
                  ]}
                  pointerEvents="none"
                />
              )}
            </View>
          </View>

          {/* Controls Bar */}
          <View style={styles.controlsBar}>
            {/* Zoom Controls */}
            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Zoom</Text>
              <View style={styles.zoomRow}>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => setZoom((prev) => Math.max(1, Math.round((prev - 0.1) * 100) / 100))}
                  disabled={zoom <= 1 || isProcessing}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="remove" size={18} color={zoom <= 1 ? '#9CA3AF' : '#374151'} />
                </TouchableOpacity>

                {Platform.OS === 'web' ? (
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.02"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    disabled={isProcessing}
                    style={{
                      width: 130,
                      accentColor: themeColor,
                      cursor: isProcessing ? 'not-allowed' : 'pointer',
                    }}
                  />
                ) : (
                  <View style={{ width: 100, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2 }} />
                )}

                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => setZoom((prev) => Math.min(3, Math.round((prev + 0.1) * 100) / 100))}
                  disabled={zoom >= 3 || isProcessing}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="add" size={18} color={zoom >= 3 ? '#9CA3AF' : '#374151'} />
                </TouchableOpacity>

                <View style={styles.zoomBadge}>
                  <Text style={styles.zoomBadgeText}>{Math.round(zoom * 100)}%</Text>
                </View>
              </View>
            </View>

            <View style={styles.dividerV} />

            {/* Action Buttons: Rotate & Reset */}
            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleRotate}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <MaterialIcons name="rotate-right" size={18} color="#374151" />
                <Text style={styles.actionBtnText}>Rotate 90°</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleReset}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <MaterialIcons name="restart-alt" size={18} color="#374151" />
                <Text style={styles.actionBtnText}>Reset</Text>
              </TouchableOpacity>

              {isLogo && (
                <TouchableOpacity
                  style={[styles.actionBtn, showCircleGuide && styles.actionBtnActive]}
                  onPress={() => setShowCircleGuide(!showCircleGuide)}
                  disabled={isProcessing}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name="radio-button-unchecked"
                    size={16}
                    color={showCircleGuide ? themeColor : '#6B7280'}
                  />
                  <Text style={[styles.actionBtnText, showCircleGuide && { color: themeColor, fontWeight: '700' }]}>
                    Circle Guide
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={onClose}
              disabled={isProcessing}
              activeOpacity={0.7}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.btnPrimary,
                { backgroundColor: themeColor },
                isProcessing && styles.btnDisabled,
              ]}
              onPress={handleApply}
              disabled={isProcessing}
              activeOpacity={0.8}
            >
              {isProcessing ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.btnPrimaryText}>Processing & Uploading...</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="check" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.btnPrimaryText}>Apply & Upload</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 9999,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 640,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 12,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  ratioBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ratioBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stage: {
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  instructionText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  cropViewport: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  viewportBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0B0F19',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  circleGuide: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    borderStyle: 'dashed',
  },
  controlsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 12,
  },
  controlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomBadge: {
    minWidth: 42,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
  },
  zoomBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  dividerV: {
    width: 1,
    height: 24,
    backgroundColor: '#CBD5E1',
  },
  quickActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  actionBtnActive: {
    borderColor: '#94A3B8',
    backgroundColor: '#F1F5F9',
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  btnSecondary: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  btnSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  btnPrimaryText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
