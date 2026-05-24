const app = document.getElementById("app");
if (app == null) {
    throw new Error("main: #app element not found");
}
app.textContent = "Sandbox Web";
