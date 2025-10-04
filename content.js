import("./bitcrusher.js").then(({ setupBitcrusher }) => {
  window.addEventListener("yt-page-data-updated", () => {
    setupBitcrusher();
  });
  setupBitcrusher();
});
