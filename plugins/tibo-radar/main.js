import '../../src/styles/global.css';
import Radar from './Radar.svelte';
import { mount } from 'svelte';
mount(Radar, { target: document.getElementById('app'), props: { standalone: true } });
