import { createRouter, createWebHashHistory } from 'vue-router';
import ReconcileView from './components/ReconcileView.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/graph', component: { template: '<div />' } },
    { path: '/review', component: { template: '<div />' } },
    { path: '/publish', component: { template: '<div />' } },
    { path: '/reconcile', component: ReconcileView }
  ]
});
