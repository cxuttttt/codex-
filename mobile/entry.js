import './mobile/mobile.css';
import { prepareMobile, showFatal } from './mobile/boot.js';

prepareMobile().then(ok => {
  if (ok) return import('./main.js');
}).catch(error => showFatal(error));
