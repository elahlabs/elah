#pragma once

#include "FramePool.hpp"
#include "HybridFrameSpikeSpec.hpp"

namespace margelo::nitro::elahmedianitro {

/** C++ on both platforms: one implementation, no Swift / Kotlin hop. */
class HybridFrameSpike : public HybridFrameSpikeSpec {
public:
  HybridFrameSpike() : HybridObject(TAG) {}

  double noop() override { return 0; }

  void createPool(double count, double width, double height) override {
    pool_.create(static_cast<int>(count), static_cast<int>(width), static_cast<int>(height));
  }

  std::optional<uint64_t> getFrame(double index) override {
    void *frame = pool_.get(static_cast<int>(index));
    if (frame == nullptr) return std::nullopt;
    return reinterpret_cast<uint64_t>(frame);
  }

  void destroyPool() override { pool_.clear(); }

private:
  elah::spike::FramePool pool_;
};

} // namespace margelo::nitro::elahmedianitro
