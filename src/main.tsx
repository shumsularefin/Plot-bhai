import { render } from 'preact';
import { App } from './ui/App';
import './ui/tokens.css';
import './ui/base.css';
import './ui/layout.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
