import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";
import Apply from "./views/Apply.vue";
import Login from "./views/Login.vue";
import LoginVerify from "./views/LoginVerify.vue";
import CheckIn from "./views/CheckIn.vue";
import Polls from "./views/Polls.vue";
import AdminQueue from "./views/AdminQueue.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Home },
    { path: "/apply", component: Apply },
    { path: "/login", component: Login },
    { path: "/login/verify", component: LoginVerify },
    { path: "/checkin", component: CheckIn },
    { path: "/polls", component: Polls },
    { path: "/admin", component: AdminQueue },
  ],
});
