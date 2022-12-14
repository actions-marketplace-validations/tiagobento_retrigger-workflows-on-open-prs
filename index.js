/*
 * Copyright 2020 Red Hat, Inc. and/or its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const core = require("@actions/core");
const github = require("@actions/github");
const {Octokit} = require("@octokit/rest")
const fetch = require("node-fetch");


function getRef(octokit, data) {
    console.info(`Getting ref for ${data.owner}/${data.repo}#${data.ref}`);
    return octokit.git.getRef({
        owner: data.owner,
        repo: data.repo,
        ref: data.ref
    }).then(res => res.data.object.sha);
}

function getCommitTree(octokit, data, sha) {
    console.info(`Getting commit tree for ${data.owner}/${data.repo}#${sha}`);
    return octokit.repos.getCommit({
        owner: data.owner,
        repo: data.repo,
        ref: sha
    }).then(res => ({sha: res.data.commit.tree.sha, commitSha: sha}));
}

function createEmptyCommit(octokit, data, tree) {
    console.info(`Creating empty commit... ${data.owner}/${data.repo}#${tree.sha}->${tree.commitSha}`);
    return octokit.git.createCommit({
        owner: data.owner,
        repo: data.repo,
        message: data.message,
        tree: tree.sha,
        parents: [tree.commitSha]
    }).then(res => res.data.sha)
}

function updateRef(octokit, data, sha) {
    console.info(`Updating ref... ${data.owner}/${data.repo}#${data.ref}-${sha}`);
    return octokit.git.updateRef({
        owner: data.owner,
        repo: data.repo,
        ref: data.ref,
        sha: sha,
        force: false
    }).then(res => res.data);
}

function createEmptyCommitOnGitHub(opts) {

    if (!opts || !opts.owner || !opts.repo || !opts.ref || !opts.message || !opts.token) {
        return Promise.reject(new Error('Invalid parameters'))
    }

    const data = {
        owner: opts.owner,
        repo: opts.repo,
        ref: opts.ref || 'heads/main',
        message: opts.message
    }

    const octokit = new Octokit({auth: opts.token});

    return getRef(octokit, data)
        .then(sha => getCommitTree(octokit, data, sha))
        .then(tree => createEmptyCommit(octokit, data, tree))
        .then(sha => updateRef(octokit, data, sha));
}

async function run() {

    const githubToken = core.getInput("github_token");

    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const branch = github.context.ref.split("/").pop();

    const githubApiDomain = `https://api.github.com`;
    const authHeaders = {
        headers: {
            Authorization: "token " + githubToken,
            Accept: "application/vnd.github.v3+json"
        }
    };

    const openPrs = await fetch(`${githubApiDomain}/repos/${owner}/${repo}/pulls?state=open&base=${branch}`, authHeaders)
        .then(c => c.json())
        .then(prs => prs.filter(pr => !pr.user.login.includes("dependabot")));

    console.log(`Found ${openPrs.length} open PR(s) targeting '${branch}'`);

    const newCommits = openPrs.map(pr => {
        console.log(`Re-triggering workflows on #${pr.number}: ${pr.title}`);
        return createEmptyCommitOnGitHub({
            owner: pr.head.user.login,
            repo: repo,
            ref: `heads/${pr.head.ref}`,
            token: githubToken,
            message: `New commit on '${branch}'. Re-triggering workflows ????`,
        }).then(res => {
            console.log(`Created ${res.object.sha} on #${pr.number}: ${pr.title}`)
            return res.object.sha;
        });
    })

    return Promise.all(newCommits);
}

run()
    .then(() => console.log("Finished."))
    .catch(e => core.setFailed(e.message));
