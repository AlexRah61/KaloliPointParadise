// hls.js ships types for its main entry only; the light build has the same API surface we use.
declare module 'hls.js/light' {
  import Hls from 'hls.js';
  export default Hls;
}
