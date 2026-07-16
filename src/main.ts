import './styles.css';
import { currentRoute, onRouteChange } from './router';
import { renderHome } from './pages/home';
import { renderDemo } from './pages/demo';

const app = document.getElementById('app')!;

let cleanupCurrentRoute: (() => void) | null = null;

function render(): void {
  if (cleanupCurrentRoute) {
    cleanupCurrentRoute();
    cleanupCurrentRoute = null;
  }

  const route = currentRoute();
  if (route.name === 'demo') {
    cleanupCurrentRoute = renderDemo(app, route.id);
  } else {
    cleanupCurrentRoute = renderHome(app);
  }
}

onRouteChange(render);
render();
