document.addEventListener('DOMContentLoaded', () => {
    // Fetch user ID from the server or set a default for testing
    const userId = 'user123'; // This should be dynamically assigned based on logged-in user

    // Function to fetch the current status of post loaders for the user
    const fetchPostLoaderStatus = () => {
        fetch(`/status/${userId}`)
            .then(response => response.json())
            .then(data => {
                if (data.postLoaderDetails) {
                    console.log('Current post loader details:', data.postLoaderDetails);
                    console.log('Current post loader active status:', data.postLoaderActive);
                    console.log('Current post loader logs:', data.postLoaderLogs);

                    // Update the UI accordingly
                    updatePostLoaderStatus(data.postLoaderDetails, data.postLoaderActive, data.postLoaderLogs);
                } else {
                    console.log(data.message);
                }
            })
            .catch(error => console.error('Error fetching post loader status:', error));
    };

    // Function to update the UI with the current post loader status
    const updatePostLoaderStatus = (details, activeStatus, logs) => {
        const statusContainer = document.getElementById('statusContainer');
        statusContainer.innerHTML = ''; // Clear existing status

        details.forEach((detail, index) => {
            const loaderStatus = document.createElement('div');
            loaderStatus.innerHTML = `
                <h3>Post Loader ${index}</h3>
                <p>Token: ${detail.token}</p>
                <p>Post ID: ${detail.postId}</p>
                <p>Message: ${detail.message}</p>
                <p>Delay: ${detail.delay}</p>
                <p>Active: ${activeStatus[index]}</p>
                <p>Logs:</p>
                <ul>${logs[index].map(log => `<li>${log}</li>`).join('')}</ul>
            `;
            statusContainer.appendChild(loaderStatus);
        });
    };

    // Initial fetch of post loader status
    fetchPostLoaderStatus();

    // Polling to update the status periodically
    setInterval(fetchPostLoaderStatus, 5000); // Adjust the interval as needed
});
