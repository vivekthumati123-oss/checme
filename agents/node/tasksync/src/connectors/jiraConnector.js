const axios =
    require("axios");

const https =
    require("https");

const settings =
    require("../config/settings");

class JiraConnector {

    constructor() {

        this.config = {

            httpsAgent:
                new https.Agent({
                    rejectUnauthorized: true
                }),

            auth: {
                username:
                    settings.jiraEmail,

                password:
                    settings.jiraApiToken
            },

            headers: {
                Accept:
                    "application/json"
            }
        };
    }

    async getIssue(
        issueKey
    ) {

        const url =
            `${settings.jiraBaseUrl}/rest/api/3/issue/${issueKey}`;

        const response =
            await axios.get(
                url,
                this.config
            );

        return response.data;
    }

    async getEpicsByProject(
        projectKey
    ) {

        const url =
            `${settings.jiraBaseUrl}/rest/api/3/search/jql`;

        const response =
            await axios.get(
                url,
                {
                    ...this.config,

                    params: {

                        jql:
                            `project=${projectKey}
                             AND issuetype=Epic
                             ORDER BY created ASC`,

                        fields:
                            "summary"
                    }
                }
            );

        return response.data.issues;
    }

    
         async getStoriesByEpic(
    epicKey
) {

    const allIssues = [];
    let startAt = 0;
    const maxResults = 50;

    while (true) {

        const response =
            await axios.get(
                `${settings.jiraBaseUrl}/rest/api/3/search`,
                {
                    ...this.config,

                    params: {
                        jql:
                            `"Epic Link"=${epicKey}
                             ORDER BY created ASC`,

                        fields:
                            "summary",

                        startAt,

                        maxResults
                    }
                }
            );

        allIssues.push(
            ...response.data.issues
        );

        if (
            response.data.issues.length <
            maxResults
        ) {
            break;
        }

        startAt += maxResults;
    }

    return allIssues;
}

   async getStoriesByProject(
    projectKey
) {

    const url =
        `${settings.jiraBaseUrl}/rest/api/3/search/jql`;

    const response =
        await axios.get(
            url,
            {
                ...this.config,

                params: {

                    jql:
                        `project=${projectKey}
                         AND issuetype=Story
                         ORDER BY created ASC`,

                    fields:
                        "summary"
                }
            }
        );

    return response.data.issues;
}
}

module.exports =
    JiraConnector;