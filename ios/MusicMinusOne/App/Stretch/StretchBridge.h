// A plain C face on Signalsmith Stretch (Vendor/), for Swift.
#ifndef STRETCH_BRIDGE_H
#define STRETCH_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SSStretch SSStretch;

SSStretch *ss_stretch_create(int channels, float sampleRate);
void ss_stretch_destroy(SSStretch *stretch);
void ss_stretch_reset(SSStretch *stretch);
int ss_stretch_input_latency(const SSStretch *stretch);
int ss_stretch_output_latency(const SSStretch *stretch);
/// Primes it with input just before where playback starts, so output starts
/// cleanly instead of fading in.
void ss_stretch_seek(SSStretch *stretch, float *const *inputs, int inputFrames, double rate);
/// `inputFrames` of input become `outputFrames` of output; their ratio is the
/// speed. Channels are separate arrays.
void ss_stretch_process(SSStretch *stretch, float *const *inputs, int inputFrames, float *const *outputs, int outputFrames);

#ifdef __cplusplus
}
#endif

#endif
