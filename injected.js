// injected.js
(() => {
  if (window.__BRAVE_BITCRUSHER_INJECTED) return;
  window.__BRAVE_BITCRUSHER_INJECTED = true;

  // Bitcrusher processor code (AudioWorklet) as string
  const processorCode = `
  class BitCrusherProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'bitDepth', defaultValue: 8, minValue: 1, maxValue: 16 },
        { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 20 }
      ];
    }
    constructor(options) {
      super();
      this.phase = 0;
      this.lastSampleValue = 0;
      this.port.onmessage = (e) => {
        // placeholder if need to receive messages
      };
    }
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      const output = outputs[0];
      if (!input || input.length === 0) return true;

      const bitDepth = parameters.bitDepth.length > 0 ? parameters.bitDepth[0] : 8;
      const downsample = parameters.downsample.length > 0 ? parameters.downsample[0] : 1;

      const step = Math.pow(0.5, bitDepth);
      // downsample: hold a sample for N frames
      for (let channel = 0; channel < input.length; channel++) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];
        for (let i = 0; i < inputChannel.length; i++) {
          if (downsample <= 1) {
            // quantize sample
            const v = Math.floor(inputChannel[i] / step) * step;
            outputChannel[i] = v;
          } else {
            // simple downsample (sample-and-hold)
            if (this.phase % Math.max(1, Math.floor(downsample)) === 0) {
              this.lastSampleValue = Math.floor(inputChannel[i] / step) * step;
            }
            outputChannel[i] = this.lastSampleValue;
            this.phase++;
          }
        }
      }
      return true;
    }
  }
  registerProcessor('bitcrusher-processor', BitCrusherProcessor);
  `;

  // create blob URL for the processor
  const blob = new Blob([processorCode], { type: 'application/javascript' });
  const processorURL = URL.createObjectURL(blob);

  // state
  let audioContext = null;
  let workletNode = null;
  let sourceNode = null;
  let connected = false;
  let currentVideo = null;
  let params = { bitDepth: 8, downsample: 1 };

  async function ensureAudioForVideo(video) {
    if (!video) return;
    // create AudioContext if needed
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // add the worklet module
      try {
        await audioContext.audioWorklet.addModule(processorURL);
      } catch (err) {
        console.error('Failed to add AudioWorklet module', err);
        return;
      }
    }
    // if already connected, disconnect first
    if (connected) {
      disconnect();
    }

    sourceNode = audioContext.createMediaElementSource(video);
    workletNode = new AudioWorkletNode(audioContext, 'bitcrusher-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: { bitDepth: params.bitDepth, downsample: params.downsample }
    });

    // default connect: source -> worklet -> destination
    sourceNode.connect(workletNode);
    workletNode.connect(audioContext.destination);
    connected = true;
    currentVideo = video;

    // send status
    window.postMessage({ source: 'brave-bitcrusher-page', payload: { enabled: true } }, '*');
  }

  function disconnect() {
    try {
      if (sourceNode) sourceNode.disconnect();
      if (workletNode) workletNode.disconnect();
    } catch(e){}
    sourceNode = null;
    workletNode = null;
    connected = false;
    window.postMessage({ source: 'brave-bitcrusher-page', payload: { enabled: false } }, '*');
  }

  // find a visible playing video element (YouTube uses <video>)
  function findVideo() {
    // prefer the main video player
    const video = document.querySelector('video');
    return video;
  }

  // Toggle function (called from extension)
  async function toggle() {
    const video = findVideo();
    if (!video) {
      console.warn('No video element found on page.');
      return { enabled: false, error: 'no-video' };
    }
    // must resume audio context on user gesture
    if (!audioContext) {
      await ensureAudioForVideo(video);
      // if audioContext is suspended due autoplay policy, resume on user gesture
      try { await audioContext.resume(); } catch(e) {}
      return { enabled: connected };
    } else {
      if (connected) {
        disconnect();
        return { enabled: false };
      } else {
        await ensureAudioForVideo(video);
        try { await audioContext.resume(); } catch(e) {}
        return { enabled: connected };
      }
    }
  }

  // set params
  function setParams(newParams) {
    params = Object.assign(params, newParams);
    if (workletNode) {
      if (workletNode.parameters) {
        const bd = workletNode.parameters.get('bitDepth');
        const ds = workletNode.parameters.get('downsample');
        if (bd) bd.setValueAtTime(params.bitDepth, audioContext.currentTime);
        if (ds) ds.setValueAtTime(params.downsample, audioContext.currentTime);
      }
    }
  }

  // respond to messages from content_script (via window messages)
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    if (!ev.data || ev.data.source !== 'brave-bitcrusher-ext') return;
    const msg = ev.data.payload;
    if (!msg || !msg.cmd) return;

    if (msg.cmd === 'toggle') {
      const res = await toggle();
      window.postMessage({ source: 'brave-bitcrusher-page', payload: res }, '*');
    } else if (msg.cmd === 'setParams') {
      setParams(msg);
      window.postMessage({ source: 'brave-bitcrusher-page', payload: { params } }, '*');
    }
  });

  // Optional: observe for new <video> elements and auto-connect if already enabled
  const mo = new MutationObserver(() => {
    if (!connected && audioContext && document.querySelector('video')) {
      // do not auto-enable; keep manual toggle
    }
  });
  mo.observe(document, { childList: true, subtree: true });

  console.log('Brave Bitcrusher injected.');
})();
