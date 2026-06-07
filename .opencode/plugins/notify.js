export const NotifyPlugin = async ({ $ }) => ({
  event: async ({ event }) => {
    if (event.type === "session.idle") {
      const title = "opencode";
      const message = "Prompt execution done";
      await $`osascript -e 'display notification "${message}" with title "${title}" sound name "default"'`;
    }
  },
});
