import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// Loopback by default. Set EXPLORER_HOST=0.0.0.0 to watch a devnet
		// running on another machine from a browser on this one.
		host: process.env.EXPLORER_HOST || false
	}
});
