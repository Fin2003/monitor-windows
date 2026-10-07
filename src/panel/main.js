import '../styles/global.css';
import PanelApp from './App.svelte';
import { mount } from 'svelte';

const app = mount(PanelApp, {
  target: document.getElementById('app'),
});

export default app;
