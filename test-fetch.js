fetch("https://generativelanguage.googleapis.com")
    .then(res => {
        console.log("CONNECTED");
        console.log("Status:", res.status);
    })
    .catch(err => {
        console.error("FETCH FAILED:", err);
    });