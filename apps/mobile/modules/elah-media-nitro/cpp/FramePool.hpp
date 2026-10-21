// RN-P6 / D6 spike: a fixed pool of GPU-shareable test frames.
//
// iOS: IOSurface-backed BGRA CVPixelBuffers (what AVAssetReader hands out with
// kCVPixelFormatType_32BGRA). Android: RGBA AHardwareBuffers with
// GPU_SAMPLED_IMAGE usage (what an ImageReader feeding off MediaCodec hands
// out, minus the YUV). react-native-webgpu's createVideoFrameFromNativeBuffer
// accepts both pointers as they are.
//
// Each frame is a solid hue with its index written as 9 bars across the top
// (white = 1, most significant bit on the left), so the screen shows which
// frame arrived. Header-only, compiled by the Nitro module on both platforms.

#pragma once

#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#include <CoreVideo/CoreVideo.h>
#elif defined(__ANDROID__)
#include <android/hardware_buffer.h>
#endif

namespace elah::spike {

struct Rgb {
  uint8_t r, g, b;
};

inline Rgb hueToRgb(double hue) {
  const double h = (hue - std::floor(hue)) * 6.0;
  const double x = 1.0 - std::fabs(std::fmod(h, 2.0) - 1.0);
  double r = 0, g = 0, b = 0;
  if (h < 1) { r = 1; g = x; }
  else if (h < 2) { r = x; g = 1; }
  else if (h < 3) { g = 1; b = x; }
  else if (h < 4) { g = x; b = 1; }
  else if (h < 5) { r = x; b = 1; }
  else { r = 1; b = x; }
  // 0.7 keeps the white bars readable against every hue.
  return {static_cast<uint8_t>(r * 178), static_cast<uint8_t>(g * 178), static_cast<uint8_t>(b * 178)};
}

constexpr int kIndexBits = 9;

inline Rgb patternPixel(int index, int count, int x, int y, int width, int height) {
  if (y < height / 6) {
    const int bar = x * kIndexBits / width;
    const bool one = (index >> (kIndexBits - 1 - bar)) & 1;
    return one ? Rgb{255, 255, 255} : Rgb{24, 24, 24};
  }
  return hueToRgb(static_cast<double>(index) / static_cast<double>(count));
}

class FramePool {
public:
  FramePool() = default;
  FramePool(const FramePool &) = delete;
  FramePool &operator=(const FramePool &) = delete;
  ~FramePool() { clear(); }

  void create(int count, int width, int height) {
    if (count <= 0 || width <= 0 || height <= 0) {
      throw std::invalid_argument("createPool: count, width and height must be positive");
    }
    clear();
    frames_.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; i++) {
      frames_.push_back(makeFrame(i, count, width, height));
    }
  }

  /** Borrowed: the pool keeps its reference until clear(). */
  void *get(int index) const {
    if (index < 0 || static_cast<size_t>(index) >= frames_.size()) return nullptr;
    return frames_[static_cast<size_t>(index)];
  }

  void clear() {
    for (void *frame : frames_) release(frame);
    frames_.clear();
  }

private:
  std::vector<void *> frames_;

#if defined(__APPLE__)
  static void *makeFrame(int index, int count, int width, int height) {
    CFDictionaryRef ioSurface = CFDictionaryCreate(kCFAllocatorDefault, nullptr, nullptr, 0,
                                                   &kCFTypeDictionaryKeyCallBacks,
                                                   &kCFTypeDictionaryValueCallBacks);
    const void *keys[] = {kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey};
    const void *values[] = {ioSurface, kCFBooleanTrue};
    CFDictionaryRef attrs = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 2,
                                               &kCFTypeDictionaryKeyCallBacks,
                                               &kCFTypeDictionaryValueCallBacks);
    CVPixelBufferRef buffer = nullptr;
    CVReturn status = CVPixelBufferCreate(kCFAllocatorDefault, static_cast<size_t>(width),
                                          static_cast<size_t>(height), kCVPixelFormatType_32BGRA,
                                          attrs, &buffer);
    CFRelease(attrs);
    CFRelease(ioSurface);
    if (status != kCVReturnSuccess || buffer == nullptr) {
      throw std::runtime_error("createPool: CVPixelBufferCreate failed (" + std::to_string(status) + ")");
    }
    CVPixelBufferLockBaseAddress(buffer, 0);
    auto *base = static_cast<uint8_t *>(CVPixelBufferGetBaseAddress(buffer));
    const size_t stride = CVPixelBufferGetBytesPerRow(buffer);
    for (int y = 0; y < height; y++) {
      uint8_t *row = base + static_cast<size_t>(y) * stride;
      for (int x = 0; x < width; x++) {
        const Rgb c = patternPixel(index, count, x, y, width, height);
        row[x * 4 + 0] = c.b;
        row[x * 4 + 1] = c.g;
        row[x * 4 + 2] = c.r;
        row[x * 4 + 3] = 255;
      }
    }
    CVPixelBufferUnlockBaseAddress(buffer, 0);
    return buffer;
  }

  static void release(void *frame) { CVPixelBufferRelease(static_cast<CVPixelBufferRef>(frame)); }

#elif defined(__ANDROID__)
  static void *makeFrame(int index, int count, int width, int height) {
    AHardwareBuffer_Desc desc{};
    desc.width = static_cast<uint32_t>(width);
    desc.height = static_cast<uint32_t>(height);
    desc.layers = 1;
    desc.format = AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM;
    desc.usage = AHARDWAREBUFFER_USAGE_GPU_SAMPLED_IMAGE | AHARDWAREBUFFER_USAGE_CPU_WRITE_RARELY;
    AHardwareBuffer *buffer = nullptr;
    int status = AHardwareBuffer_allocate(&desc, &buffer);
    if (status != 0 || buffer == nullptr) {
      throw std::runtime_error("createPool: AHardwareBuffer_allocate failed (" + std::to_string(status) + ")");
    }
    AHardwareBuffer_describe(buffer, &desc); // desc.stride is in pixels
    void *address = nullptr;
    status = AHardwareBuffer_lock(buffer, AHARDWAREBUFFER_USAGE_CPU_WRITE_RARELY, -1, nullptr, &address);
    if (status != 0 || address == nullptr) {
      AHardwareBuffer_release(buffer);
      throw std::runtime_error("createPool: AHardwareBuffer_lock failed (" + std::to_string(status) + ")");
    }
    auto *base = static_cast<uint8_t *>(address);
    for (int y = 0; y < height; y++) {
      uint8_t *row = base + static_cast<size_t>(y) * desc.stride * 4;
      for (int x = 0; x < width; x++) {
        const Rgb c = patternPixel(index, count, x, y, width, height);
        row[x * 4 + 0] = c.r;
        row[x * 4 + 1] = c.g;
        row[x * 4 + 2] = c.b;
        row[x * 4 + 3] = 255;
      }
    }
    AHardwareBuffer_unlock(buffer, nullptr);
    return buffer;
  }

  static void release(void *frame) { AHardwareBuffer_release(static_cast<AHardwareBuffer *>(frame)); }

#else
  static void *makeFrame(int, int, int, int) { throw std::runtime_error("FramePool: unsupported platform"); }
  static void release(void *) {}
#endif
};

} // namespace elah::spike
