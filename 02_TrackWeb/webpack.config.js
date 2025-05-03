const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './src/background.ts',
    stats: './src/stats.ts',
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/*.html', to: '[name].html' },
        { from: 'icons/*.png', to: 'icons/[name].png' },
        { from: 'src/*.css', to: '[name].css' },
      ],
    }),
  ],
}; 