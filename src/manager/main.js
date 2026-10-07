import '../styles/global.css';
import ManagerApp from './App.svelte';
import { mount } from 'svelte';

const app = mount(ManagerApp, {
  target: document.getElementById('app'),
});

export default app;
