// Session Check
(function () {
    var token = localStorage.getItem('sessionToken');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    fetch('/check-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
    }).then(function (r) { return r.json(); }).then(function (data) {
        if (!data.valid) {
            localStorage.removeItem('sessionToken');
            window.location.href = '/login.html';
        }
    }).catch(function () {
        window.location.href = '/login.html';
    });
})();

document.getElementById('sendBtn').addEventListener('click', async function () {
    var token = localStorage.getItem('sessionToken');
    if (!token) {
        alert('Please login first.');
        window.location.href = '/login.html';
        return;
    }

    var btn = this;
    var progressSection = document.getElementById('progressSection');
    var progressBar = document.getElementById('progressBar');
    var statusText = document.getElementById('statusText');

    var senderAccounts = document.getElementById('senderAccounts').value.trim();
    var subject = document.getElementById('subject').value.trim();
    var limitPerAccount = document.getElementById('limitPerAccount').value.trim();
    var replyTo = document.getElementById('replyTo').value.trim();
    var message = document.getElementById('message').value.trim();
    var to = document.getElementById('to').value.trim();

    if (!senderAccounts || !subject || !message || !to) {
        alert('❌ Please fill all required fields.');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Processing...';
    progressSection.style.display = 'block';
    statusText.textContent = 'Initializing...';

    try {
        var res = await fetch('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                senderAccountsString: senderAccounts,
                subject: subject,
                limitPerAccount: limitPerAccount,
                replyTo: replyTo,
                message: message,
                to: to
            })
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);

                    if (data.type === 'progress') {
                        const percent = (data.sent / data.total) * 100;
                        progressBar.style.width = percent + '%';
                        
                        statusText.textContent = `Sent: ${data.sent} / ${data.total} (Via: ${data.currentEmail})`;
                        statusText.style.color = '#007bff';
                    } else if (data.type === 'done') {
                        progressBar.style.width = '100%';
                        statusText.textContent = '✅ Completed!';
                        statusText.style.color = '#28a745';

                        var summary = '✅ Sent: ' + data.sent;
                        if (data.fail > 0) summary += '  ❌ Fail: ' + data.fail;

                        setTimeout(() => {
                            alert(summary + '\nTime: ' + data.timeTaken + 's');
                        }, 500);
                    } else if (data.msg) {
                        throw new Error(data.msg);
                    }
                } catch (e) {
                    console.error("Stream Parse Error", e);
                }
            }
        }

    } catch (err) {
        statusText.textContent = '❌ Error: ' + err.message;
        statusText.style.color = '#dc3545';
        progressBar.style.backgroundColor = '#dc3545';
        alert('⚠️ ' + err.message);
    }

    btn.disabled = false;
    btn.textContent = 'Send All (Max Speed)';
});

document.getElementById('logoutBtn').addEventListener('click', function () {
    fetch('/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: localStorage.getItem('sessionToken') })
    }).finally(function () {
        localStorage.removeItem('sessionToken');
        window.location.href = '/login.html';
    });
});
