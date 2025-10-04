document.getElementById("activate").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  chrome.scripting.executeScript({
    target: {tabId: tab.id},
    function: activateBitcrusher
  });
});

document.getElementById("reset").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  chrome.scripting.executeScript({
    target: {tabId: tab.id},
    function: resetAudio
  });
});

// Função que será injetada na aba (mesma do console, simplificada)
function activateBitcrusher() {
  (async () => {
    if (window.__bitcrusherActive) {
      console.log("⚠️ Bitcrusher já ativo");
      return;
    }
    const video = document.querySelector("video");
    if (!video) {
      console.log("❌ Nenhum vídeo encontrado");
      return;
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
      class BitCrusherProcessor extends AudioWorkletProcessor {
        static get parameterDescriptors() {
          return [
            { name: 'bitDepth', defaultValue: 8, minValue: 1, maxValue: 16 },
            { name: 'downsample', defaultValue: 4, minValue: 1, maxValue: 20 }
          ];
        }
        constructor(){ super(); this.phase=0; this.last=0; }
        process(inputs, outputs, parameters){
          const input=inputs[0], output=outputs[0];
          if(!input.length) return true;
          const bd=parameters.bitDepth[0], ds=parameters.downsample[0];
          const step=Math.pow(0.5, bd);
          for(let ch=0; ch<input.length; ch++){
            const inp=input[ch], out=output[ch];
            for(let i=0; i<inp.length; i++){
              if(this.phase % ds === 0){
                this.last = Math.floor(inp[i]/step)*step;
              }
              out[i]=this.last;
              this.phase++;
            }
          }
          return true;
        }
      }
      registerProcessor("bitcrusher", BitCrusherProcessor);
    `], {type:"application/javascript"})));

    const src = ctx.createMediaElementSource(video);
    const crusher = new AudioWorkletNode(ctx, "bitcrusher");
    src.connect(crusher).connect(ctx.destination);
    await ctx.resume();

    window.__bitcrusherActive = {ctx, src, crusher};
    console.log("✅ Bitcrusher ativado");
  })();
}

// Função para resetar (desconectar)
function resetAudio() {
  if (window.__bitcrusherActive) {
    try {
      window.__bitcrusherActive.src.disconnect();
      window.__bitcrusherActive.crusher.disconnect();
      window.__bitcrusherActive.ctx.close();
    } catch(e) {}
    window.__bitcrusherActive = null;
    console.log("🔄 Reset feito (áudio original restaurado).");
  } else {
    console.log("⚠️ Bitcrusher não estava ativo.");
  }
}
