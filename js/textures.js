/**
 * Procedural texture generator for WebVR Mölkky
 * Generates realistic wood grain, numbered pin caps, grass, and scoreboard textures
 */

const TextureGenerator = {
  /**
   * Generates a wooden texture canvas
   */
  createWoodCanvas(width = 512, height = 512, baseColor = '#d2a679', grainColor = '#b37d46') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Base background
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    // Wood rings & grain simulation
    ctx.fillStyle = grainColor;
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 250; i++) {
      const y = Math.random() * height;
      const h = Math.random() * 4 + 1;
      ctx.fillRect(0, y, width, h);
    }

    // Fiber noise
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const len = Math.random() * 40 + 10;
      ctx.fillRect(x, y, len, 1);
    }

    // Knots in wood
    ctx.globalAlpha = 0.12;
    for (let k = 0; k < 3; k++) {
      const kx = Math.random() * width;
      const ky = Math.random() * height;
      const kr = Math.random() * 20 + 8;
      const grad = ctx.createRadialGradient(kx, ky, 2, kx, ky, kr);
      grad.addColorStop(0, '#5c3818');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
    return canvas;
  },

  /**
   * Generates a numbered texture for pin tops/sides
   * @param {number} num Number from 1 to 12
   */
  createPinNumberCanvas(num, width = 256, height = 256) {
    const canvas = this.createWoodCanvas(width, height, '#deb887', '#b58348');
    const ctx = canvas.getContext('2d');

    // Draw circular border
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#3a200e';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width * 0.42, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle inner shadow
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(74, 43, 17, 0.4)';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width * 0.38, 0, Math.PI * 2);
    ctx.stroke();

    // Wood burned / engraved number effect
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 110px "Segoe UI", Arial, sans-serif';

    // Shadow for engraved relief
    ctx.fillStyle = 'rgba(255, 230, 200, 0.4)';
    ctx.fillText(num.toString(), width / 2 + 2, height / 2 + 2);

    // Deep wood burned color
    ctx.fillStyle = '#2d1808';
    ctx.fillText(num.toString(), width / 2, height / 2);

    ctx.restore();
    return canvas;
  },

  /**
   * Generates grass lawn ground canvas
   */
  createGrassCanvas(width = 512, height = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Base summer grass green
    ctx.fillStyle = '#4f7d32';
    ctx.fillRect(0, 0, width, height);

    // Varied blade shades
    const colors = ['#3d6325', '#5b8e39', '#6da345', '#365820', '#7bb44c'];
    for (let c = 0; c < colors.length; c++) {
      ctx.fillStyle = colors[c];
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 3500; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const w = Math.random() * 3 + 1;
        const h = Math.random() * 7 + 2;
        ctx.fillRect(x, y, w, h);
      }
    }

    ctx.globalAlpha = 1.0;
    return canvas;
  },

  /**
   * Generates a wooden totem texture for the scoreboard
   */
  createScoreboardCanvas(width = 512, height = 512) {
    const canvas = this.createWoodCanvas(width, height, '#50331e', '#362111');
    const ctx = canvas.getContext('2d');

    // Metallic trim border
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    ctx.strokeStyle = '#8c6d1f';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, width - 36, height - 36);

    return canvas;
  }
};
