import { initAnalytics } from './analytics';
import { captureAttribution } from './attribution';
import { initAnchors } from './scroll';
import { initHeader, initPersistentCta } from './chrome';
import { initGallery } from './gallery';
import { initFilm } from './film';
import { initShowingForm } from './form';
import { initMotion } from './motion';

captureAttribution();
initAnalytics();
initHeader();
initAnchors();
initPersistentCta();
initGallery();
initFilm();
initShowingForm();
void initMotion();
