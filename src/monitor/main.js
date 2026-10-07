import '../styles/global.css';
import MonitorApp from './App.svelte';
import { mount } from 'svelte';

const app = mount(MonitorApp, {
  target: document.getElementById('app'),
});

export default app;
