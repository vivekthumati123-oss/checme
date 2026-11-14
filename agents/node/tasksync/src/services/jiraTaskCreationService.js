 

const axios =
    require("axios");

const settings =
    require("../config/settings");

class JiraTaskCreationService {

    async createTask(
        parentIssueKey,
        task
    ) {

        

        const url =
            `${settings.jiraBaseUrl}/rest/api/3/issue`;

        const payload = {
            fields: {

                project: {
                    key:
                        parentIssueKey
                            .split("-")[0]
                },

                parent: {
                    key:
                        parentIssueKey
                },

                summary:
                    task.title,
description: {
    type: "doc",
    version: 1,
    content: [
        {
            type: "paragraph",
            content: [
                {
                    type: "text",
                    text:
                        task.description
                }
            ]
        }
    ]
},

                issuetype: {
                              name: "Sub-task"
                        }
            }
        };

         
        try {

           const response =
    await axios.post(
        url,
        payload,
        {
            timeout: 30000,

            auth: {
                username:
                    settings.jiraEmail,

                password:
                    settings.jiraApiToken
            },

            headers: {
                Accept:
                    "application/json",

                "Content-Type":
                    "application/json"
            }
        }
    );
                           
            

            return response.data;

        } catch (error) {

          

            if (
                error.response
            ) {

                

            } else {

                console.log(
                    error.message
                );
            }

            throw error;
        }
    }
}

module.exports =
    JiraTaskCreationService;