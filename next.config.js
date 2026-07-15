/** @type {import('next').NextConfig} */
module.exports = {
  async headers() {
    return [
      {
        // track.js debe poder cargarse desde tu landing (otro dominio)
        source: '/track.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
    ];
  },
};
