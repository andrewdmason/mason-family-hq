#include "StretchBridge.h"
#include "../../Vendor/signalsmith-stretch.h"

struct SSStretch {
    signalsmith::stretch::SignalsmithStretch<float> engine;
};

SSStretch *ss_stretch_create(int channels, float sampleRate) {
    auto *s = new SSStretch();
    s->engine.presetDefault(channels, sampleRate);
    return s;
}

void ss_stretch_destroy(SSStretch *s) { delete s; }
void ss_stretch_reset(SSStretch *s) { s->engine.reset(); }
int ss_stretch_input_latency(const SSStretch *s) { return s->engine.inputLatency(); }
int ss_stretch_output_latency(const SSStretch *s) { return s->engine.outputLatency(); }

void ss_stretch_seek(SSStretch *s, float *const *inputs, int inputFrames, double rate) {
    s->engine.seek(inputs, inputFrames, rate);
}

void ss_stretch_process(SSStretch *s, float *const *inputs, int inputFrames, float *const *outputs, int outputFrames) {
    s->engine.process(inputs, inputFrames, outputs, outputFrames);
}
