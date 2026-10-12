import { handleChat } from "../../api/chat.js";

export const onRequestPost = ({ request, env }) => handleChat(request, env);
