const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './src/background/index.ts',
    stats: './src/stats/stats.ts',
    popup: './src/popup/popup.ts'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    // Ensure .ts and .tsx are resolved before .js
    extensions: ['.ts', '.tsx', '.js'],
  },
  output: {
    filename: '[name].bundle.js', // Output multiple bundles
    path: path.resolve(__dirname, 'dist'),
    clean: false, // Let npm script handle cleaning
  },
  mode: 'production', // Default to production, can be overridden
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "src/manifest.json", to: "manifest.json" },
        { from: "src/**/*.html", to: "[name][ext]" },
        { from: "src/**/*.css", to: "[name][ext]" },
        { from: "icons", to: "icons" }
      ],
    }),
  ],
  // Optional: Add devtool for debugging in development
  // devtool: 'inline-source-map', // Use 'cheap-module-source-map' for production if needed
}; 